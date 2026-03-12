import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateAnnouncementBody,
  ListAnnouncementsQuery,
  UpdateAnnouncementBody,
} from './announcements.schema.js';

function mapAnnouncement(
  announcement: {
    id: string;
    title: string;
    body: string;
    images: string[];
    publishedAt: Date;
    expiresAt: Date | null;
    isPinned: boolean;
    createdAt: Date;
    updatedAt: Date;
    reads: { id: string }[];
  },
  wasRead?: boolean,
) {
  const readFlag = wasRead ?? announcement.reads.length > 0;
  const status = readFlag ? 'read' : 'unread';
  return {
    id: announcement.id,
    title: announcement.title,
    description: announcement.body,
    images: announcement.images,
    startsAt: announcement.publishedAt,
    endsAt: announcement.expiresAt,
    isPinned: announcement.isPinned,
    status,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
  };
}

export async function listAnnouncements(userId: string, query: ListAnnouncementsQuery) {
  const tenant = await requireTenantContext(userId);
  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;
  const now = new Date();

  const where: Prisma.AnnouncementWhereInput = {
    tenantId: tenant.tenantId,
    deletedAt: null,
    publishedAt: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    ...(query.status === 'read'
      ? { reads: { some: { userId } } }
      : query.status === 'unread'
        ? { reads: { none: { userId } } }
        : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { publishedAt: 'desc' }],
      skip,
      take: limit,
      include: {
        reads: {
          where: { userId },
          select: { id: true },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data: rows.map((row) => mapAnnouncement(row)),
    meta: {
      total,
      page,
      pageSize: limit,
      totalPages,
    },
  };
}

export async function getAnnouncement(userId: string, id: string, markAsRead = true) {
  const tenant = await requireTenantContext(userId);
  const now = new Date();
  const announcement = await prisma.announcement.findFirst({
    where: {
      id,
      tenantId: tenant.tenantId,
      deletedAt: null,
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    include: {
      reads: {
        where: { userId },
        select: { id: true },
      },
    },
  });

  if (!announcement) {
    throw httpError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
  }

  let read = announcement.reads.length > 0;

  if (markAsRead && !read) {
    await prisma.announcementRead.upsert({
      where: {
        announcementId_userId: {
          announcementId: id,
          userId,
        },
      },
      create: {
        announcementId: id,
        userId,
      },
      update: { readAt: new Date() },
    });
    read = true;
  }

  return mapAnnouncement(announcement, read);
}

export async function markAnnouncementRead(userId: string, id: string) {
  const tenant = await requireTenantContext(userId);
  const now = new Date();
  const exists = await prisma.announcement.findFirst({
    where: {
      id,
      tenantId: tenant.tenantId,
      deletedAt: null,
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    select: { id: true },
  });

  if (!exists) {
    throw httpError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
  }

  await prisma.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId: id,
        userId,
      },
    },
    create: {
      announcementId: id,
      userId,
    },
    update: { readAt: new Date() },
  });

  return { message: 'Announcement marked as read.' };
}

export async function createAnnouncement(actorId: string, body: CreateAnnouncementBody) {
  const tenant = await requireTenantContext(actorId);
  const created = await prisma.announcement.create({
    data: {
      tenantId: tenant.tenantId,
      title: body.title,
      body: body.description,
      images: body.images ?? [],
      publishedAt: body.startsAt ? new Date(body.startsAt) : new Date(),
      expiresAt: body.endsAt ? new Date(body.endsAt) : null,
      isPinned: body.isPinned ?? false,
      authorId: actorId,
    },
    include: {
      reads: { select: { id: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_created,
      entityType: 'announcement',
      entityId: created.id,
    },
  });

  return mapAnnouncement(created, false);
}

export async function updateAnnouncement(actorId: string, id: string, body: UpdateAnnouncementBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.announcement.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
  }

  const updateData: Prisma.AnnouncementUpdateInput = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.body = body.description;
  if (body.images !== undefined) updateData.images = body.images;
  if (body.startsAt !== undefined) updateData.publishedAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) updateData.expiresAt = new Date(body.endsAt);
  if (body.isPinned !== undefined) updateData.isPinned = body.isPinned;

  const updated = await prisma.announcement.update({
    where: { id },
    data: updateData,
    include: {
      reads: { select: { id: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_updated,
      entityType: 'announcement',
      entityId: updated.id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapAnnouncement(updated, false);
}

export async function deleteAnnouncement(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.announcement.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found.');
  }

  const deletedAt = new Date();
  await prisma.announcement.update({
    where: { id },
    data: {
      deletedAt,
      isPinned: false,
      expiresAt: deletedAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'announcement',
      entityId: id,
      metadata: {
        softDelete: true,
        deletedAt: deletedAt.toISOString(),
      },
    },
  });

  return { message: 'Announcement archived.' };
}
