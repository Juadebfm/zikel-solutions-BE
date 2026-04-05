import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateCalendarEventBody,
  ListCalendarEventsQuery,
  UpdateCalendarEventBody,
} from './calendar.schema.js';

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

type CalendarEventRow = Prisma.HomeEventGetPayload<{
  include: { home: { select: { id: true; name: true; careGroupId: true; careGroup: { select: { id: true; name: true } } } } };
}>;

function mapCalendarEvent(row: CalendarEventRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    startAt: row.startsAt,
    endAt: row.endsAt,
    homeId: row.homeId,
    homeName: row.home.name,
    careGroupId: row.home.careGroupId,
    careGroupName: row.home.careGroup?.name ?? null,
    attendeeIds: row.attendeeIds,
    recurrence: row.recurrence,
    allDay: row.allDay,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureHomeInTenant(tenantId: string, homeId: string) {
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

function validateEventDates(startAt: Date, endAt: Date | null | undefined) {
  if (endAt && endAt < startAt) {
    throw httpError(422, 'INVALID_EVENT_RANGE', 'endAt must be greater than or equal to startAt.');
  }
}

export async function listCalendarEvents(actorUserId: string, query: ListCalendarEventsQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.HomeEventWhereInput = {
    tenantId: tenant.tenantId,
  };

  if (query.homeId) where.homeId = query.homeId;
  if (query.careGroupId) where.home = { careGroupId: query.careGroupId };
  if (query.type) where.type = query.type;
  if (query.dateFrom || query.dateTo) {
    where.startsAt = {};
    if (query.dateFrom) where.startsAt.gte = query.dateFrom;
    if (query.dateTo) where.startsAt.lte = query.dateTo;
  }

  const [total, rows] = await Promise.all([
    prisma.homeEvent.count({ where }),
    prisma.homeEvent.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { startsAt: 'asc' },
      include: { home: { select: { id: true, name: true, careGroupId: true, careGroup: { select: { id: true, name: true } } } } },
    }),
  ]);

  return {
    data: rows.map(mapCalendarEvent),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getCalendarEvent(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.homeEvent.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: { home: { select: { id: true, name: true, careGroupId: true, careGroup: { select: { id: true, name: true } } } } },
  });

  if (!row) {
    throw httpError(404, 'CALENDAR_EVENT_NOT_FOUND', 'Calendar event not found.');
  }

  return mapCalendarEvent(row);
}

export async function createCalendarEvent(actorUserId: string, body: CreateCalendarEventBody) {
  const tenant = await requireTenantContext(actorUserId);
  await ensureHomeInTenant(tenant.tenantId, body.homeId);
  validateEventDates(body.startAt, body.endAt ?? null);

  const created = await prisma.homeEvent.create({
    data: {
      tenantId: tenant.tenantId,
      homeId: body.homeId,
      title: body.title,
      description: body.description ?? null,
      type: body.type,
      startsAt: body.startAt,
      endsAt: body.endAt ?? null,
      attendeeIds: body.attendeeIds,
      recurrence: (body.recurrence ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
      allDay: body.allDay,
    },
    include: { home: { select: { id: true, name: true, careGroupId: true, careGroup: { select: { id: true, name: true } } } } },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_created,
      entityType: 'calendar_event',
      entityId: created.id,
      metadata: {
        type: created.type,
      },
    },
  });

  return mapCalendarEvent(created);
}

export async function updateCalendarEvent(actorUserId: string, id: string, body: UpdateCalendarEventBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.homeEvent.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true, startsAt: true, endsAt: true, homeId: true },
  });

  if (!existing) {
    throw httpError(404, 'CALENDAR_EVENT_NOT_FOUND', 'Calendar event not found.');
  }

  if (body.homeId !== undefined) {
    await ensureHomeInTenant(tenant.tenantId, body.homeId);
  }

  const startsAt = body.startAt ?? existing.startsAt;
  const endsAt = body.endAt !== undefined ? body.endAt : existing.endsAt;
  validateEventDates(startsAt, endsAt ?? null);

  const updateData: Prisma.HomeEventUpdateInput = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.startAt !== undefined) updateData.startsAt = body.startAt;
  if (body.endAt !== undefined) updateData.endsAt = body.endAt;
  if (body.homeId !== undefined) updateData.home = { connect: { id: body.homeId } };
  if (body.attendeeIds !== undefined) updateData.attendeeIds = body.attendeeIds;
  if (body.recurrence !== undefined) {
    updateData.recurrence = (body.recurrence ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  }
  if (body.allDay !== undefined) updateData.allDay = body.allDay;

  const updated = await prisma.homeEvent.update({
    where: { id },
    data: updateData,
    include: { home: { select: { id: true, name: true, careGroupId: true, careGroup: { select: { id: true, name: true } } } } },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'calendar_event',
      entityId: id,
      metadata: {
        fields: Object.keys(body),
      },
    },
  });

  return mapCalendarEvent(updated);
}

export async function deleteCalendarEvent(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.homeEvent.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'CALENDAR_EVENT_NOT_FOUND', 'Calendar event not found.');
  }

  await prisma.homeEvent.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'calendar_event',
      entityId: id,
    },
  });

  return { message: 'Calendar event deleted.' };
}
