import { AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { getSummaryStats } from '../summary/summary.service.js';
import type { CreateWidgetBody } from './dashboard.schema.js';

export async function getDashboardStats(userId: string) {
  return getSummaryStats(userId);
}

export async function listWidgets(userId: string) {
  const tenant = await requireTenantContext(userId);
  return prisma.widget.findMany({
    where: { userId, tenantId: tenant.tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createWidget(userId: string, body: CreateWidgetBody) {
  const tenant = await requireTenantContext(userId);
  const widget = await prisma.widget.create({
    data: {
      tenantId: tenant.tenantId,
      userId,
      title: body.title,
      period: body.period,
      reportsOn: body.reportsOn,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId,
      action: AuditAction.record_created,
      entityType: 'widget',
      entityId: widget.id,
    },
  });

  return widget;
}

export async function deleteWidget(userId: string, widgetId: string) {
  const tenant = await requireTenantContext(userId);
  const widget = await prisma.widget.findUnique({ where: { id: widgetId } });
  if (!widget || widget.tenantId !== tenant.tenantId) {
    throw httpError(404, 'WIDGET_NOT_FOUND', 'Widget not found.');
  }
  if (widget.userId !== userId) {
    throw httpError(403, 'FORBIDDEN', 'Widget belongs to another user.');
  }

  await prisma.widget.delete({ where: { id: widgetId } });
  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId,
      action: AuditAction.record_deleted,
      entityType: 'widget',
      entityId: widgetId,
    },
  });

  return { message: 'Widget deleted.' };
}
