import {
  AuditAction,
  SecurityAlertSeverity,
  SecurityAlertType,
  type AuditLog,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

type AuditLogEvent = Pick<
  AuditLog,
  'id' | 'tenantId' | 'userId' | 'action' | 'entityType' | 'entityId' | 'metadata' | 'createdAt'
>;

type AlertCandidate = {
  type: SecurityAlertType;
  severity: SecurityAlertSeverity;
  details: string;
  context?: Record<string, unknown>;
};

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function summarizeMetadata(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  const obj = asObject(value);
  if (!obj) return null;

  const allowedKeys = [
    'failedAttempts',
    'accountLocked',
    'reason',
    'previousTenantId',
    'targetTenantId',
    'type',
  ];

  const summary: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (obj[key] !== undefined) summary[key] = obj[key];
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function buildWebhookPayload(args: {
  event: AuditLogEvent;
  alert: AlertCandidate;
  deliveryId: string;
}) {
  return {
    deliveryId: args.deliveryId,
    alert: {
      type: args.alert.type,
      severity: args.alert.severity,
      details: args.alert.details,
      context: args.alert.context ?? null,
    },
    source: {
      auditLogId: args.event.id,
      action: args.event.action,
      entityType: args.event.entityType,
      entityId: args.event.entityId,
      tenantId: args.event.tenantId,
      userId: args.event.userId,
      timestamp: args.event.createdAt.toISOString(),
      metadata: summarizeMetadata(args.event.metadata),
    },
    emittedAt: new Date().toISOString(),
  };
}

async function classifyAuditEvent(
  client: PrismaClient,
  event: AuditLogEvent,
): Promise<AlertCandidate | null> {
  if (event.entityType === 'cross_tenant_access_blocked') {
    return {
      type: SecurityAlertType.cross_tenant_attempts,
      severity: SecurityAlertSeverity.high,
      details: 'Blocked cross-tenant access attempt detected.',
    };
  }

  if (event.entityType === 'break_glass_access') {
    return {
      type: SecurityAlertType.break_glass_access,
      severity: SecurityAlertSeverity.high,
      details: 'Break-glass access lifecycle event recorded.',
    };
  }

  if (event.action === AuditAction.permission_changed) {
    return {
      type: SecurityAlertType.admin_changes,
      severity: SecurityAlertSeverity.medium,
      details: 'Permission change recorded for a privileged action.',
    };
  }

  if (event.action === AuditAction.login && event.entityType === 'auth_login_failed' && event.userId) {
    const windowStart = new Date(Date.now() - (30 * 60 * 1_000));
    const failedCount = await client.auditLog.count({
      where: {
        userId: event.userId,
        action: AuditAction.login,
        entityType: 'auth_login_failed',
        createdAt: { gte: windowStart },
      },
    });

    if (failedCount < 5) {
      return null;
    }

    const duplicateWindowStart = new Date(Date.now() - (30 * 60 * 1_000));
    const existing = await client.securityAlertDelivery.findFirst({
      where: {
        userId: event.userId,
        type: SecurityAlertType.repeated_auth_failures,
        createdAt: { gte: duplicateWindowStart },
      },
      select: { id: true },
    });
    if (existing) {
      return null;
    }

    return {
      type: SecurityAlertType.repeated_auth_failures,
      severity: SecurityAlertSeverity.high,
      details: `User has ${failedCount} failed login attempts in the last 30 minutes.`,
      context: { failedCount, windowMinutes: 30 },
    };
  }

  return null;
}

async function dispatchWebhook(args: {
  webhookUrl: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const timeoutMs = env.SECURITY_ALERT_WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(args.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Zikel-Alert-Source': 'security-alert-pipeline',
      },
      body: JSON.stringify(args.payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `Webhook responded with status ${response.status}.` };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook dispatch error.';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function markDeliveryAttempt(
  client: PrismaClient,
  deliveryId: string,
  attempt: { success: boolean; error?: string },
) {
  const existing = await client.securityAlertDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, attemptCount: true },
  });
  if (!existing) {
    return;
  }

  await client.securityAlertDelivery.update({
    where: { id: deliveryId },
    data: {
      attemptCount: existing.attemptCount + 1,
      status: attempt.success ? 'delivered' : 'failed',
      dispatchedAt: attempt.success ? new Date() : null,
      lastError: attempt.success ? null : (attempt.error ?? 'Unknown dispatch error.'),
    },
  });
}

async function dispatchDeliveryById(client: PrismaClient, deliveryId: string) {
  const delivery = await client.securityAlertDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      auditLog: {
        select: {
          id: true,
          tenantId: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  });

  if (!delivery || delivery.status === 'delivered') {
    return;
  }

  if (!delivery.webhookUrl) {
    logger.warn({
      msg: 'Security alert delivery is queued without webhook URL.',
      deliveryId: delivery.id,
      alertType: delivery.type,
    });
    return;
  }

  const payloadObject = asObject(delivery.payload);
  const details = typeof payloadObject?.details === 'string'
    ? payloadObject.details
    : 'Security alert generated.';
  const contextValue = payloadObject?.context;
  const alert: AlertCandidate = {
    type: delivery.type,
    severity: delivery.severity,
    details,
    ...(
      contextValue &&
      typeof contextValue === 'object' &&
      !Array.isArray(contextValue)
        ? { context: contextValue as Record<string, unknown> }
        : {}
    ),
  };

  const payload = buildWebhookPayload({
    event: delivery.auditLog,
    alert,
    deliveryId: delivery.id,
  });

  const webhookResult = await dispatchWebhook({
    webhookUrl: delivery.webhookUrl,
    payload,
  });

  if (!webhookResult.ok) {
    await markDeliveryAttempt(client, delivery.id, {
      success: false,
      error: webhookResult.error,
    });
    logger.error({
      msg: 'Security alert webhook dispatch failed.',
      deliveryId: delivery.id,
      alertType: delivery.type,
      error: webhookResult.error,
    });
    return;
  }

  await markDeliveryAttempt(client, delivery.id, { success: true });
  logger.info({
    msg: 'Security alert delivered.',
    deliveryId: delivery.id,
    alertType: delivery.type,
  });
}

export async function queueAndDispatchSecurityAlert(
  client: PrismaClient,
  event: AuditLogEvent,
) {
  if (!env.SECURITY_ALERT_PIPELINE_ENABLED) {
    return;
  }

  const alert = await classifyAuditEvent(client, event);
  if (!alert) {
    return;
  }

  const delivery = await client.securityAlertDelivery.create({
    data: {
      auditLogId: event.id,
      tenantId: event.tenantId,
      userId: event.userId,
      type: alert.type,
      severity: alert.severity,
      status: 'pending',
      payload: {
        details: alert.details,
        context: (alert.context ?? null) as Prisma.InputJsonValue,
      } as Prisma.InputJsonObject,
      webhookUrl: env.SECURITY_ALERT_WEBHOOK_URL ?? null,
    },
    select: { id: true },
  });

  void dispatchDeliveryById(client, delivery.id).catch((error) => {
    logger.error({
      msg: 'Security alert dispatch background task failed.',
      deliveryId: delivery.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  });
}

export async function dispatchQueuedSecurityAlerts(client: PrismaClient, limit = 50) {
  const pending = await client.securityAlertDelivery.findMany({
    where: {
      status: { in: ['pending', 'failed'] },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  for (const row of pending) {
    await dispatchDeliveryById(client, row.id);
  }
}
