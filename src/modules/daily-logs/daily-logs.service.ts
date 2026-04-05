import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import * as tasksService from '../tasks/tasks.service.js';
import type { CreateDailyLogBody, UpdateDailyLogBody, ListDailyLogsQuery } from './daily-logs.schema.js';

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createDailyLog(actorUserId: string, body: CreateDailyLogBody) {
  const home = await prisma.home.findUnique({
    where: { id: body.homeId },
    select: { name: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  const dateLabel = new Date(body.noteDate).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const title = `Daily Log — ${home.name} — ${dateLabel}`;

  const noteDate = new Date(body.noteDate);

  // Map relatesTo to the appropriate task field or reference.
  const relatesToType = body.relatesTo?.type;
  const relatesToId = body.relatesTo?.id;

  // Build a reference for entity types not directly on the Task model.
  const references =
    relatesToType === 'employee' || relatesToType === 'home_event'
      ? [
          {
            type: 'entity' as const,
            entityType: relatesToType === 'employee' ? ('employee' as const) : ('home' as const),
            entityId: relatesToId!,
            label: relatesToType === 'employee' ? 'Related employee' : 'Related event',
          },
        ]
      : undefined;

  return tasksService.createTask(actorUserId, {
    title,
    description: body.note,
    category: 'daily_log',
    homeId: body.homeId,
    youngPersonId: relatesToType === 'young_person' ? relatesToId : undefined,
    vehicleId: relatesToType === 'vehicle' ? relatesToId : undefined,
    dueDate: null,
    dueAt: null,
    formTemplateKey: body.triggerTaskFormKey,
    priority: 'medium',
    submittedAt: noteDate,
    references,
    submissionPayload: {
      dailyLogCategory: body.category,
      noteDate: body.noteDate,
      relatesTo: body.relatesTo ?? null,
    },
  });
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listDailyLogs(actorUserId: string, query: ListDailyLogsQuery) {
  return tasksService.listTasks(actorUserId, {
    page: query.page,
    pageSize: query.pageSize,
    scope: 'all',
    period: 'all',
    category: 'daily_log',
    homeId: query.homeId,
    youngPersonId: query.youngPersonId,
    vehicleId: query.vehicleId,
    dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
    dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getDailyLog(actorUserId: string, id: string) {
  const task = await tasksService.getTask(actorUserId, id);
  if (task.category !== 'daily_log') {
    throw httpError(404, 'DAILY_LOG_NOT_FOUND', 'Daily log not found.');
  }
  return task;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateDailyLog(actorUserId: string, id: string, body: UpdateDailyLogBody) {
  await getDailyLog(actorUserId, id);

  const update: Record<string, unknown> = {};

  if (body.note !== undefined) update.description = body.note;
  if (body.homeId !== undefined) update.homeId = body.homeId;
  if (body.triggerTaskFormKey !== undefined) update.formTemplateKey = body.triggerTaskFormKey;

  if (body.relatesTo !== undefined) {
    if (body.relatesTo === null) {
      update.youngPersonId = null;
      update.vehicleId = null;
    } else if (body.relatesTo.type === 'young_person') {
      update.youngPersonId = body.relatesTo.id;
      update.vehicleId = null;
    } else if (body.relatesTo.type === 'vehicle') {
      update.vehicleId = body.relatesTo.id;
      update.youngPersonId = null;
    } else {
      // employee / home_event — stored in submissionPayload, not as FK
      update.youngPersonId = null;
      update.vehicleId = null;
    }
  }

  return tasksService.updateTask(actorUserId, id, update as Parameters<typeof tasksService.updateTask>[2]);
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteDailyLog(actorUserId: string, id: string) {
  await getDailyLog(actorUserId, id);
  return tasksService.deleteTask(actorUserId, id);
}
