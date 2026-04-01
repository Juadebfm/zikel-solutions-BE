import { AuditAction, UserRole, TenantRole, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { queueWebhookDelivery } from '../../lib/webhook-dispatcher.js';
import type { CreateWebhookBody, ListDeliveriesQuery, UpdateWebhookBody } from './webhooks.schema.js';

type WebhookActorContext = {
  userId: string;
  userRole: UserRole;
  tenantId: string;
  tenantRole: TenantRole | null;
};

async function resolveWebhookActor(userId: string): Promise<WebhookActorContext> {
  const tenant = await requireTenantContext(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  return {
    userId: user.id,
    userRole: user.role,
    tenantId: tenant.tenantId,
    tenantRole: tenant.tenantRole,
  };
}

function isWebhookAdmin(actor: WebhookActorContext) {
  if (actor.userRole === UserRole.super_admin || actor.userRole === UserRole.admin) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function assertWebhookAdmin(actor: WebhookActorContext) {
  if (!isWebhookAdmin(actor)) {
    throw httpError(403, 'FORBIDDEN', 'Only admins can manage webhook endpoints.');
  }
}

export async function listWebhookEndpoints(userId: string) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  return prisma.webhookEndpoint.findMany({
    where: { tenantId: actor.tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      events: true,
      isActive: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { deliveries: true } },
    },
  });
}

export async function createWebhookEndpoint(userId: string, body: CreateWebhookBody) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  const createData: Parameters<typeof prisma.webhookEndpoint.create>[0]['data'] = {
    tenantId: actor.tenantId,
    url: body.url,
    secret: body.secret,
    events: body.events,
    createdById: actor.userId,
  };
  if (body.description !== undefined) createData.description = body.description;

  const endpoint = await prisma.webhookEndpoint.create({ data: createData });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_created,
      entityType: 'webhook_endpoint',
      entityId: endpoint.id,
      metadata: { url: body.url, events: body.events },
    },
  });

  return endpoint;
}

export async function updateWebhookEndpoint(
  userId: string,
  endpointId: string,
  body: UpdateWebhookBody,
) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId: actor.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  }

  const updateData: Parameters<typeof prisma.webhookEndpoint.update>[0]['data'] = {};
  if (body.url !== undefined) updateData.url = body.url;
  if (body.secret !== undefined) updateData.secret = body.secret;
  if (body.events !== undefined) updateData.events = body.events;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const updated = await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'webhook_endpoint',
      entityId: endpointId,
      metadata: { changes: Object.keys(body) },
    },
  });

  return updated;
}

export async function deleteWebhookEndpoint(userId: string, endpointId: string) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId: actor.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  }

  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_deleted,
      entityType: 'webhook_endpoint',
      entityId: endpointId,
    },
  });

  return { message: 'Webhook endpoint deleted.' };
}

export async function listDeliveries(
  userId: string,
  endpointId: string,
  query: ListDeliveriesQuery,
) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId: actor.tenantId },
    select: { id: true },
  });

  if (!endpoint) {
    throw httpError(404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  }

  const { page, pageSize, status } = query;

  const where: Prisma.WebhookDeliveryWhereInput = { endpointId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        eventType: true,
        status: true,
        attemptCount: true,
        lastError: true,
        dispatchedAt: true,
        createdAt: true,
      },
    }),
    prisma.webhookDelivery.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function sendTestPayload(userId: string, endpointId: string) {
  const actor = await resolveWebhookActor(userId);
  assertWebhookAdmin(actor);

  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, tenantId: actor.tenantId },
    select: { id: true, isActive: true },
  });

  if (!endpoint) {
    throw httpError(404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  }

  const delivery = await queueWebhookDelivery({
    endpointId: endpoint.id,
    eventType: 'test',
    payload: {
      event: 'test',
      message: 'This is a test webhook delivery from Zikel Solutions.',
      timestamp: new Date().toISOString(),
    },
  });

  return { deliveryId: delivery.id, message: 'Test payload queued.' };
}
