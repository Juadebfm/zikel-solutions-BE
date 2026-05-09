import { AuditAction, TicketStatus, type Prisma, UserRole, TenantRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { emitWebhookEvent } from '../../lib/webhook-dispatcher.js';
import { emitNotification } from '../../lib/notification-emitter.js';
import type {
  CreateTicketBody,
  CreateTicketCommentBody,
  ListTicketsQuery,
  UpdateTicketBody,
} from './tickets.schema.js';

type TicketActorContext = {
  userId: string;
  userRole: UserRole;
  tenantId: string;
  tenantRole: TenantRole | null;
};

async function resolveTicketActor(userId: string): Promise<TicketActorContext> {
  const tenant = await requireTenantContext(userId);
  const user = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return {
    userId: user.id,
    userRole: user.role,
    tenantId: tenant.tenantId,
    tenantRole: tenant.tenantRole,
  };
}

function isTicketAdmin(actor: TicketActorContext) {
  if (actor.userRole === UserRole.admin) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

export async function createTicket(userId: string, body: CreateTicketBody) {
  const actor = await resolveTicketActor(userId);

  const ticket = await prisma.supportTicket.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      title: body.title,
      description: body.description,
      priority: body.priority,
      category: body.category,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_created,
      entityType: 'support_ticket',
      entityId: ticket.id,
      metadata: { category: body.category, priority: body.priority },
    },
  });

  // Emit webhook event for external integrations (Zendesk, Freshdesk, etc.)
  void emitWebhookEvent({
    tenantId: actor.tenantId,
    eventType: 'ticket_created',
    payload: {
      ticket: {
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        user: ticket.user,
        createdAt: ticket.createdAt.toISOString(),
      },
    },
  });

  return ticket;
}

export async function listTickets(userId: string, query: ListTicketsQuery) {
  const actor = await resolveTicketActor(userId);
  const { page, pageSize, status, priority, category, search } = query;

  const where: Prisma.SupportTicketWhereInput = {
    tenantId: actor.tenantId,
  };

  // Non-admins only see their own tickets
  if (!isTicketAdmin(actor)) {
    where.userId = actor.userId;
  }

  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { comments: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getTicket(userId: string, ticketId: string) {
  const actor = await resolveTicketActor(userId);

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, tenantId: actor.tenantId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!ticket) {
    throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
  }

  // Non-admins can only see their own tickets
  if (!isTicketAdmin(actor) && ticket.userId !== actor.userId) {
    throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
  }

  // Filter internal comments for non-admins
  if (!isTicketAdmin(actor)) {
    ticket.comments = ticket.comments.filter((c) => !c.isInternal);
  }

  return ticket;
}

export async function updateTicket(userId: string, ticketId: string, body: UpdateTicketBody) {
  const actor = await resolveTicketActor(userId);

  if (!isTicketAdmin(actor)) {
    throw httpError(403, 'FORBIDDEN', 'Only admins can update ticket status.');
  }

  const existing = await prisma.supportTicket.findFirst({
    where: { id: ticketId, tenantId: actor.tenantId },
    select: { id: true, status: true, userId: true },
  });

  if (!existing) {
    throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
  }

  const data: Prisma.SupportTicketUncheckedUpdateInput = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.category !== undefined) data.category = body.category;

  // Track resolution/close timestamps
  if (body.status === 'resolved' && existing.status !== 'resolved') {
    data.resolvedAt = new Date();
  }
  if (body.status === 'closed' && existing.status !== 'closed') {
    data.closedAt = new Date();
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data,
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'support_ticket',
      entityId: ticketId,
      metadata: { changes: body, previousStatus: existing.status },
    },
  });

  // Notify ticket owner of status change
  if (body.status && body.status !== existing.status) {
    void emitNotification({
      level: 'tenant',
      category: 'ticket_update',
      tenantId: actor.tenantId,
      title: 'Ticket status updated',
      body: `Your ticket "${updated.title}" has been updated to ${body.status.replace(/_/g, ' ')}.`,
      metadata: { ticketId, status: body.status },
      recipientUserIds: [existing.userId],
      createdById: actor.userId,
    });

    void emitWebhookEvent({
      tenantId: actor.tenantId,
      eventType: 'ticket_status_changed',
      payload: {
        ticket: {
          id: updated.id,
          title: updated.title,
          status: updated.status,
          previousStatus: existing.status,
          priority: updated.priority,
          category: updated.category,
        },
      },
    });
  }

  return updated;
}

export async function addComment(userId: string, ticketId: string, body: CreateTicketCommentBody) {
  const actor = await resolveTicketActor(userId);

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, tenantId: actor.tenantId },
    select: { id: true, userId: true, title: true },
  });

  if (!ticket) {
    throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
  }

  // Non-admins can only comment on their own tickets, and cannot write internal notes
  if (!isTicketAdmin(actor)) {
    if (ticket.userId !== actor.userId) {
      throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
    }
    if (body.isInternal) {
      throw httpError(403, 'FORBIDDEN', 'Only admins can write internal notes.');
    }
  }

  const comment = await prisma.ticketComment.create({
    data: {
      ticketId,
      userId: actor.userId,
      body: body.body,
      isInternal: body.isInternal,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify the other party (admin comments notify ticket owner, user comments notify admins)
  if (!body.isInternal) {
    if (actor.userId === ticket.userId) {
      // User commented — notify tenant admins
      const { getTenantAdminUserIds } = await import('../../lib/notification-emitter.js');
      const adminIds = await getTenantAdminUserIds(actor.tenantId);
      void emitNotification({
        level: 'tenant',
        category: 'ticket_update',
        tenantId: actor.tenantId,
        title: 'New comment on support ticket',
        body: `A user commented on ticket "${ticket.title}".`,
        metadata: { ticketId },
        recipientUserIds: adminIds,
        createdById: actor.userId,
      });
    } else {
      // Admin commented — notify ticket owner
      void emitNotification({
        level: 'tenant',
        category: 'ticket_update',
        tenantId: actor.tenantId,
        title: 'New reply on your support ticket',
        body: `An admin replied to your ticket "${ticket.title}".`,
        metadata: { ticketId },
        recipientUserIds: [ticket.userId],
        createdById: actor.userId,
      });
    }
  }

  void emitWebhookEvent({
    tenantId: actor.tenantId,
    eventType: 'ticket_comment_added',
    payload: {
      ticketId,
      comment: {
        id: comment.id,
        body: comment.body,
        isInternal: comment.isInternal,
        user: comment.user,
        createdAt: comment.createdAt.toISOString(),
      },
    },
  });

  return comment;
}

export async function closeTicket(userId: string, ticketId: string) {
  const actor = await resolveTicketActor(userId);

  if (!isTicketAdmin(actor)) {
    throw httpError(403, 'FORBIDDEN', 'Only admins can close tickets.');
  }

  const existing = await prisma.supportTicket.findFirst({
    where: { id: ticketId, tenantId: actor.tenantId },
    select: { id: true, status: true, userId: true, title: true },
  });

  if (!existing) {
    throw httpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
  }

  if (existing.status === TicketStatus.closed) {
    throw httpError(422, 'ALREADY_CLOSED', 'Ticket is already closed.');
  }

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: TicketStatus.closed, closedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'support_ticket',
      entityId: ticketId,
      metadata: { action: 'close', previousStatus: existing.status },
    },
  });

  void emitNotification({
    level: 'tenant',
    category: 'ticket_update',
    tenantId: actor.tenantId,
    title: 'Ticket closed',
    body: `Your ticket "${existing.title}" has been closed.`,
    metadata: { ticketId },
    recipientUserIds: [existing.userId],
    createdById: actor.userId,
  });

  return { message: 'Ticket closed.' };
}
