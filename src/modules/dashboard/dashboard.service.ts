import { AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { getSummaryStats } from '../summary/summary.service.js';
import type { CreateWidgetBody } from './dashboard.schema.js';

export async function getDashboardStats(userId: string) {
  return getSummaryStats(userId);
}

export async function listWidgets(userId: string) {
  return prisma.widget.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createWidget(userId: string, body: CreateWidgetBody) {
  const widget = await prisma.widget.create({
    data: {
      userId,
      title: body.title,
      period: body.period,
      reportsOn: body.reportsOn,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.record_created,
      entityType: 'widget',
      entityId: widget.id,
    },
  });

  return widget;
}

export async function deleteWidget(userId: string, widgetId: string) {
  const widget = await prisma.widget.findUnique({ where: { id: widgetId } });
  if (!widget) {
    throw httpError(404, 'WIDGET_NOT_FOUND', 'Widget not found.');
  }
  if (widget.userId !== userId) {
    throw httpError(403, 'FORBIDDEN', 'Widget belongs to another user.');
  }

  await prisma.widget.delete({ where: { id: widgetId } });
  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.record_deleted,
      entityType: 'widget',
      entityId: widgetId,
    },
  });

  return { message: 'Widget deleted.' };
}
