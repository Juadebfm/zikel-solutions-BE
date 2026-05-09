import { type NotificationCategory, type Prisma, MembershipStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { emitNotification } from '../../lib/notification-emitter.js';
import type {
  BroadcastNotificationBody,
  ListNotificationsQuery,
  UpdatePreferencesBody,
} from './notifications.schema.js';

export async function listNotifications(userId: string, query: ListNotificationsQuery) {
  const { page, pageSize, status, level, category, since } = query;

  const where: Prisma.NotificationRecipientWhereInput = {
    userId,
  };

  if (status === 'read') where.readAt = { not: null };
  if (status === 'unread') where.readAt = null;

  const notificationWhere: Prisma.NotificationWhereInput = {};
  if (level) notificationWhere.level = level;
  if (category) notificationWhere.category = category;
  if (since) notificationWhere.createdAt = { gt: since };

  // Exclude expired notifications
  notificationWhere.OR = [
    { expiresAt: null },
    { expiresAt: { gt: new Date() } },
  ];

  if (Object.keys(notificationWhere).length > 0) {
    where.notification = notificationWhere;
  }

  const [rows, total] = await Promise.all([
    prisma.notificationRecipient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        notification: {
          select: {
            id: true,
            level: true,
            category: true,
            title: true,
            body: true,
            metadata: true,
            createdAt: true,
            expiresAt: true,
          },
        },
      },
    }),
    prisma.notificationRecipient.count({ where }),
  ]);

  const data = rows.map((r) => ({
    id: r.notification.id,
    recipientId: r.id,
    level: r.notification.level,
    category: r.notification.category,
    title: r.notification.title,
    body: r.notification.body,
    metadata: r.notification.metadata,
    isRead: r.readAt !== null,
    readAt: r.readAt,
    createdAt: r.notification.createdAt,
    expiresAt: r.notification.expiresAt,
  }));

  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getUnreadCount(userId: string) {
  const count = await prisma.notificationRecipient.count({
    where: {
      userId,
      readAt: null,
      notification: {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    },
  });

  return { count };
}

export async function markRead(userId: string, notificationId: string) {
  const recipient = await prisma.notificationRecipient.findFirst({
    where: { notificationId, userId },
  });

  if (!recipient) {
    throw httpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');
  }

  if (recipient.readAt) return { message: 'Already read.' };

  await prisma.notificationRecipient.update({
    where: { id: recipient.id },
    data: { readAt: new Date() },
  });

  return { message: 'Marked as read.' };
}

export async function markAllRead(userId: string) {
  const result = await prisma.notificationRecipient.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { updated: result.count };
}

export async function getPreferences(userId: string) {
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { category: true, enabled: true },
    orderBy: { category: 'asc' },
  });

  return prefs;
}

export async function updatePreferences(userId: string, body: UpdatePreferencesBody) {
  const operations = body.preferences.map((pref) =>
    prisma.notificationPreference.upsert({
      where: {
        userId_category: { userId, category: pref.category as NotificationCategory },
      },
      update: { enabled: pref.enabled },
      create: {
        userId,
        category: pref.category as NotificationCategory,
        enabled: pref.enabled,
      },
    }),
  );

  await prisma.$transaction(operations);

  return getPreferences(userId);
}

export async function broadcastPlatformNotification(
  actorUserId: string,
  body: BroadcastNotificationBody,
) {
  let recipientUserIds: string[];

  if (body.tenantIds && body.tenantIds.length > 0) {
    // Send to specific tenants
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: { in: body.tenantIds },
        status: MembershipStatus.active,
      },
      select: { userId: true },
    });
    recipientUserIds = [...new Set(members.map((m) => m.userId))];
  } else {
    // Send to all active users
    const users = await prisma.tenantUser.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    recipientUserIds = users.map((u) => u.id);
  }

  if (recipientUserIds.length === 0) {
    throw httpError(422, 'NO_RECIPIENTS', 'No active users found to notify.');
  }

  const params: Parameters<typeof emitNotification>[0] = {
    level: 'platform',
    category: body.category as NotificationCategory,
    tenantId: null,
    title: body.title,
    body: body.body,
    recipientUserIds,
    createdById: actorUserId,
  };
  if (body.expiresAt) params.expiresAt = body.expiresAt;

  await emitNotification(params);

  return { recipientCount: recipientUserIds.length };
}
