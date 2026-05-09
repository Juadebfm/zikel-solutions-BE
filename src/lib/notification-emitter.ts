import { type NotificationCategory, type NotificationLevel } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './logger.js';
import { emitWebhookEvent } from './webhook-dispatcher.js';

export type EmitNotificationParams = {
  level: NotificationLevel;
  category: NotificationCategory;
  tenantId: string | null;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  recipientUserIds: string[];
  createdById?: string;
  expiresAt?: Date;
};

export async function emitNotification(params: EmitNotificationParams): Promise<void> {
  try {
    if (params.recipientUserIds.length === 0) return;

    // Filter out users who have opted out of this category
    const optedOut = await prisma.notificationPreference.findMany({
      where: {
        userId: { in: params.recipientUserIds },
        category: params.category,
        enabled: false,
      },
      select: { userId: true },
    });
    const optedOutSet = new Set(optedOut.map((p) => p.userId));
    const recipients = params.recipientUserIds.filter((id) => !optedOutSet.has(id));
    if (recipients.length === 0) return;

    const data: Parameters<typeof prisma.notification.create>[0]['data'] = {
      level: params.level,
      category: params.category,
      tenantId: params.tenantId,
      title: params.title,
      body: params.body,
      recipients: {
        createMany: {
          data: recipients.map((userId) => ({ userId })),
        },
      },
    };
    if (params.metadata) data.metadata = params.metadata;
    if (params.createdById) data.createdById = params.createdById;
    if (params.expiresAt) data.expiresAt = params.expiresAt;

    const notification = await prisma.notification.create({ data });

    // Dispatch to tenant webhook endpoints subscribed to notification events
    if (params.tenantId) {
      void emitWebhookEvent({
        tenantId: params.tenantId,
        eventType: 'notification_broadcast',
        payload: {
          notificationId: notification.id,
          level: params.level,
          category: params.category,
          title: params.title,
          body: params.body,
          metadata: params.metadata ?? null,
          recipientCount: recipients.length,
        },
      }).catch((err) => {
        logger.error({ err, notificationId: notification.id }, 'Failed to emit notification webhook.');
      });
    }
  } catch (err) {
    // Notifications are best-effort — never break the caller
    logger.error({ err, category: params.category }, 'Failed to emit notification.');
  }
}

export async function getTenantMemberUserIds(tenantId: string): Promise<string[]> {
  const members = await prisma.tenantMembership.findMany({
    where: { tenantId, status: 'active' },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function getTenantAdminUserIds(tenantId: string): Promise<string[]> {
  const admins = await prisma.tenantMembership.findMany({
    where: {
      tenantId,
      status: 'active',
      role: { name: { in: ['Owner', 'Admin'] } },
    },
    select: { userId: true },
  });
  return admins.map((m) => m.userId);
}
