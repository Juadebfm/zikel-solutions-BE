import {
  MembershipStatus,
  Prisma,
  SafeguardingRiskAlertSeverity,
  SafeguardingRiskAlertStatus,
  SafeguardingRiskAlertTargetType,
  SafeguardingRiskAlertType,
  TaskApprovalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TenantRole,
  UserRole,
} from '@prisma/client';
import {
  canUseRestrictedConfidentialityScope,
  maskIdentifier,
  parseSensitiveKeySet,
  redactSensitiveText,
  redactStructuredValue,
  type ConfidentialityScope,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { emitNotification } from '../../lib/notification-emitter.js';
import { emitWebhookEvent } from '../../lib/webhook-dispatcher.js';
import { sendSafeguardingRiskAlertEmail } from '../../lib/email.js';
import type {
  CreateRiskAlertNoteBody,
  EvaluateRiskAlertsBody,
  RiskAlertConfidentialityScope,
  RiskAlertDetailQuery,
  ListRiskAlertsQuery,
  RiskAlertSeverity,
  RiskAlertStatus,
  RiskAlertTargetType,
  RiskAlertType,
  UpdateRiskAlertStateBody,
} from './risk-alerts.schema.js';

type RiskRuleDefinition = {
  key: RiskAlertType;
  name: string;
  description: string;
  defaultSeverity: RiskAlertSeverity;
  windowHours: number;
  threshold: number;
};

type RiskCandidate = {
  type: RiskAlertType;
  severity: RiskAlertSeverity;
  targetType: RiskAlertTargetType;
  targetId: string;
  homeId: string | null;
  youngPersonId: string | null;
  ruleKey: string;
  dedupeKey: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
};

type EvaluateRiskArgs = {
  tenantId: string;
  actorUserId?: string | null | undefined;
  homeId?: string | undefined;
  youngPersonId?: string | undefined;
  lookbackHours?: number;
  mode: 'event' | 'manual' | 'scheduled';
  sendEmailHooks?: boolean;
};

type ScheduledRiskBackfillArgs = {
  lookbackHours?: number;
  sendEmailHooks?: boolean;
  tenantIds?: string[];
};

type ScheduledRiskBackfillSummary = {
  startedAt: string;
  completedAt: string;
  tenantCount: number;
  succeededCount: number;
  failedCount: number;
  failedTenantIds: string[];
  totalCandidates: number;
  createdCount: number;
  reopenedCount: number;
  updatedCount: number;
  severityRaisedCount: number;
  routedCount: number;
};

type AlertWithNotes = Prisma.SafeguardingRiskAlertGetPayload<{
  include: { notes: { orderBy: { createdAt: 'asc' } } };
}>;

type AlertSelect = Prisma.SafeguardingRiskAlertGetPayload<{
  select: {
    id: true;
    tenantId: true;
    type: true;
    severity: true;
    status: true;
    targetType: true;
    targetId: true;
    homeId: true;
    youngPersonId: true;
    ruleKey: true;
    dedupeKey: true;
    title: true;
    description: true;
    evidence: true;
    windowStart: true;
    windowEnd: true;
    firstTriggeredAt: true;
    lastTriggeredAt: true;
    triggeredCount: true;
    ownerUserId: true;
    acknowledgedById: true;
    acknowledgedAt: true;
    resolvedById: true;
    resolvedAt: true;
    lastEvaluatedAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

type TaskForRisk = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    category: true;
    status: true;
    approvalStatus: true;
    priority: true;
    dueDate: true;
    createdAt: true;
    updatedAt: true;
    homeId: true;
    youngPersonId: true;
    home: { select: { id: true; name: true } };
    youngPerson: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

type HomeEventForRisk = Prisma.HomeEventGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    startsAt: true;
    homeId: true;
    home: { select: { id: true; name: true } };
  };
}>;

type SafeguardingActorContext = {
  userId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
  tenantId: string;
};

type ResolvedConfidentiality = {
  requestedScope: ConfidentialityScope;
  effectiveScope: ConfidentialityScope;
};

const RISK_SEVERITY_RANK: Record<RiskAlertSeverity, number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

const ACTIVE_TASK_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];
const HIGH_PRIORITY_LEVELS: TaskPriority[] = [TaskPriority.high, TaskPriority.urgent];

const HOME_EVENT_CRITICAL_TERMS = ['emergency', 'missing', 'police', 'injury', 'safeguard'];
const HOME_EVENT_HIGH_TERMS = ['urgent', 'incident', 'escalat'];

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function defaultConfidentialityScope(): ConfidentialityScope {
  return process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE === 'restricted'
    ? 'restricted'
    : 'standard';
}

function riskAlertRetentionDays(): number {
  return parsePositiveInt(process.env.SAFEGUARDING_RISK_ALERT_RETENTION_DAYS, 365, 30);
}

const RISK_ALERT_SENSITIVE_KEYS = parseSensitiveKeySet(process.env.AI_CONTEXT_REDACTION_SENSITIVE_KEYS);

export const SAFEGUARDING_RISK_RULES: RiskRuleDefinition[] = [
  {
    key: 'high_severity_incident',
    name: 'High-Severity Incident Presence',
    description:
      'Triggers when high-priority incident tasks appear in the last 24 hours for a home or young person.',
    defaultSeverity: 'high',
    windowHours: 24,
    threshold: 1,
  },
  {
    key: 'repeated_incident_pattern',
    name: 'Repeated Incident Pattern',
    description:
      'Triggers when three or more incident tasks are linked to the same young person within seven days.',
    defaultSeverity: 'high',
    windowHours: 24 * 7,
    threshold: 3,
  },
  {
    key: 'rejected_approval_spike',
    name: 'Rejected Approval Spike',
    description:
      'Triggers when two or more rejected approvals are recorded in a short review window.',
    defaultSeverity: 'high',
    windowHours: 48,
    threshold: 2,
  },
  {
    key: 'overdue_high_priority_tasks',
    name: 'Overdue High-Priority Backlog',
    description:
      'Triggers when high/urgent tasks are overdue and unresolved in operational queues.',
    defaultSeverity: 'high',
    windowHours: 24 * 7,
    threshold: 3,
  },
  {
    key: 'critical_home_event_signal',
    name: 'Critical Home Event Signal',
    description:
      'Triggers when home event language indicates potential safeguarding escalation.',
    defaultSeverity: 'high',
    windowHours: 72,
    threshold: 1,
  },
];

function canEvaluateRiskAlerts() {
  const client = prisma as unknown as {
    safeguardingRiskAlert?: {
      findMany?: unknown;
      create?: unknown;
      update?: unknown;
    };
  };
  return (
    typeof client.safeguardingRiskAlert?.findMany === 'function'
    && typeof client.safeguardingRiskAlert?.create === 'function'
    && typeof client.safeguardingRiskAlert?.update === 'function'
  );
}

function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function compactText(value: string | null | undefined, max = 240): string {
  if (!value) return '';
  const text = value.trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function targetDisplayNameFromTask(task: TaskForRisk): string {
  if (task.youngPerson) {
    const full = `${task.youngPerson.firstName ?? ''} ${task.youngPerson.lastName ?? ''}`.trim();
    if (full) return full;
  }
  if (task.home?.name) return task.home.name;
  return 'tenant scope';
}

function keyForTarget(args: { targetType: RiskAlertTargetType; targetId: string }) {
  return `${args.targetType}:${args.targetId}`;
}

function hasCriticalHomeEventTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return HOME_EVENT_CRITICAL_TERMS.some((term) => lower.includes(term));
}

function hasHighHomeEventTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return HOME_EVENT_HIGH_TERMS.some((term) => lower.includes(term));
}

function isOverdueHighPriorityTask(task: TaskForRisk, now: Date): boolean {
  if (!ACTIVE_TASK_STATUSES.includes(task.status)) return false;
  if (!HIGH_PRIORITY_LEVELS.includes(task.priority)) return false;
  if (!task.dueDate) return false;
  return task.dueDate.getTime() < now.getTime();
}

function mapAlert(
  row: AlertSelect,
  notes: AlertWithNotes['notes'] = [],
  scope: ConfidentialityScope = defaultConfidentialityScope(),
) {
  const baseEvidence = row.evidence as Record<string, unknown> | null;
  const mappedNotes = notes.map((note) => ({
    id: note.id,
    alertId: note.alertId,
    tenantId: note.tenantId,
    userId: note.userId,
    note: scope === 'restricted' ? note.note : redactSensitiveText(note.note),
    isEscalation: note.isEscalation,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }));

  const evidence =
    scope === 'restricted'
      ? baseEvidence
      : (redactStructuredValue({
          value: baseEvidence ?? {},
          scope: 'standard',
          sensitiveKeys: RISK_ALERT_SENSITIVE_KEYS,
        }) as Record<string, unknown>);

  return {
    ...row,
    targetId: scope === 'restricted' ? row.targetId : (maskIdentifier(row.targetId) ?? '[redacted-id]'),
    homeId: scope === 'restricted' ? row.homeId : maskIdentifier(row.homeId),
    youngPersonId: scope === 'restricted' ? row.youngPersonId : maskIdentifier(row.youngPersonId),
    title: scope === 'restricted' ? row.title : redactSensitiveText(row.title),
    description: scope === 'restricted' ? row.description : redactSensitiveText(row.description),
    evidence,
    notes: mappedNotes,
    confidentialityScope: scope,
  };
}

async function resolveSafeguardingActor(userId: string): Promise<SafeguardingActorContext> {
  const tenant = await requireTenantContext(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  return {
    userId: user.id,
    userRole: user.role,
    tenantRole: tenant.tenantRole,
    tenantId: tenant.tenantId,
  };
}

function isRiskAlertViewer(actor: SafeguardingActorContext) {
  if (actor.userRole === UserRole.super_admin) return true;
  if (actor.userRole === UserRole.admin || actor.userRole === UserRole.manager) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function assertRiskAlertViewer(actor: SafeguardingActorContext) {
  if (!isRiskAlertViewer(actor)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to access safeguarding risk alerts.');
  }
}

function resolveConfidentialityScope(args: {
  actor: SafeguardingActorContext;
  requestedScope: RiskAlertConfidentialityScope | undefined;
}): ResolvedConfidentiality {
  const requestedScope = args.requestedScope ?? defaultConfidentialityScope();
  if (requestedScope === 'restricted') {
    const allowed = canUseRestrictedConfidentialityScope({
      userRole: args.actor.userRole,
      tenantRole: args.actor.tenantRole,
    });
    if (!allowed) {
      throw httpError(403, 'CONFIDENTIAL_SCOPE_FORBIDDEN', 'Restricted confidentiality scope is not permitted for this account.');
    }
  }
  return {
    requestedScope,
    effectiveScope: requestedScope,
  };
}

function retentionCutoff(reference = new Date()): Date {
  const retentionDays = riskAlertRetentionDays();
  return new Date(reference.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
}

async function assertOwnerWithinTenant(tenantId: string, ownerUserId: string) {
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId,
      userId: ownerUserId,
      status: MembershipStatus.active,
    },
    select: { userId: true },
  });
  if (!membership) {
    throw httpError(
      422,
      'INVALID_OWNER',
      'The selected owner is not an active member of this tenant.',
    );
  }
}

function buildTaskWhere(args: {
  tenantId: string;
  now: Date;
  lookbackFrom: Date;
  homeId?: string | undefined;
  youngPersonId?: string | undefined;
}) {
  const where: Prisma.TaskWhereInput = {
    tenantId: args.tenantId,
    deletedAt: null,
    OR: [
      { createdAt: { gte: args.lookbackFrom, lte: args.now } },
      { updatedAt: { gte: args.lookbackFrom, lte: args.now } },
      {
        dueDate: { lt: args.now },
        status: { in: ACTIVE_TASK_STATUSES },
        priority: { in: HIGH_PRIORITY_LEVELS },
      },
    ],
  };

  if (args.homeId) {
    where.homeId = args.homeId;
  }
  if (args.youngPersonId) {
    where.youngPersonId = args.youngPersonId;
  }

  return where;
}

function groupByKey<T>(rows: T[], toKey: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const row of rows) {
    const key = toKey(row);
    if (!out[key]) out[key] = [];
    out[key].push(row);
  }
  return out;
}

function buildRiskCandidates(args: {
  tenantId: string;
  tasks: TaskForRisk[];
  homeEvents: HomeEventForRisk[];
  now: Date;
}): RiskCandidate[] {
  const candidates: RiskCandidate[] = [];

  const window24h = new Date(args.now.getTime() - 24 * 60 * 60 * 1_000);
  const window48h = new Date(args.now.getTime() - 48 * 60 * 60 * 1_000);
  const window72h = new Date(args.now.getTime() - 72 * 60 * 60 * 1_000);
  const window7d = new Date(args.now.getTime() - 7 * 24 * 60 * 60 * 1_000);

  // Rule 1: high-severity incident presence by target scope.
  const highSeverityIncidents = args.tasks.filter((task) =>
    task.category === TaskCategory.incident
    && task.createdAt >= window24h
    && (
      task.priority === TaskPriority.high
      || task.priority === TaskPriority.urgent
      || task.approvalStatus === TaskApprovalStatus.rejected
    ),
  );

  const incidentsByTarget = groupByKey(highSeverityIncidents, (task) => {
    if (task.youngPersonId) return keyForTarget({ targetType: 'young_person', targetId: task.youngPersonId });
    if (task.homeId) return keyForTarget({ targetType: 'home', targetId: task.homeId });
    return keyForTarget({ targetType: 'tenant', targetId: args.tenantId });
  });

  for (const [targetKey, items] of Object.entries(incidentsByTarget)) {
    const [targetType, targetId] = targetKey.split(':') as [RiskAlertTargetType, string];
    const urgentHit = items.some((task) => task.priority === TaskPriority.urgent);
    const severity: RiskAlertSeverity = urgentHit || items.length >= 2 ? 'critical' : 'high';
    const label = targetDisplayNameFromTask(items[0]!);

    candidates.push({
      type: 'high_severity_incident',
      severity,
      targetType,
      targetId,
      homeId: items[0]?.homeId ?? null,
      youngPersonId: items[0]?.youngPersonId ?? null,
      ruleKey: 'high_severity_incident',
      dedupeKey: `high_severity_incident:${targetType}:${targetId}`,
      title: `High-severity incident detected (${label})`,
      description: `${items.length} high-severity incident task(s) were recorded in the last 24 hours for ${label}.`,
      evidence: {
        incidentCount: items.length,
        windowHours: 24,
        taskIds: items.map((task) => task.id),
        tasks: items.slice(0, 10).map((task) => ({
          taskId: task.id,
          title: task.title,
          priority: task.priority,
          approvalStatus: task.approvalStatus,
          createdAt: task.createdAt.toISOString(),
          route: `/tasks?taskId=${task.id}`,
        })),
      },
      windowStart: window24h,
      windowEnd: args.now,
    });
  }

  // Rule 2: repeated incident pattern by young person.
  const incident7d = args.tasks.filter((task) =>
    task.category === TaskCategory.incident
    && task.youngPersonId
    && task.createdAt >= window7d,
  );
  const incidentsByYoungPerson = groupByKey(incident7d, (task) => task.youngPersonId as string);
  for (const [youngPersonId, items] of Object.entries(incidentsByYoungPerson)) {
    if (items.length < 3) continue;
    const severity: RiskAlertSeverity = items.length >= 5 ? 'critical' : 'high';
    const label = targetDisplayNameFromTask(items[0]!);

    candidates.push({
      type: 'repeated_incident_pattern',
      severity,
      targetType: 'young_person',
      targetId: youngPersonId,
      homeId: items[0]?.homeId ?? null,
      youngPersonId,
      ruleKey: 'repeated_incident_pattern',
      dedupeKey: `repeated_incident_pattern:young_person:${youngPersonId}`,
      title: `Repeated incident pattern (${label})`,
      description: `${items.length} incident tasks were logged for ${label} in the last 7 days.`,
      evidence: {
        incidentCount: items.length,
        threshold: 3,
        windowHours: 24 * 7,
        taskIds: items.map((task) => task.id),
        tasks: items.slice(0, 12).map((task) => ({
          taskId: task.id,
          title: task.title,
          priority: task.priority,
          createdAt: task.createdAt.toISOString(),
          route: `/tasks?taskId=${task.id}`,
        })),
      },
      windowStart: window7d,
      windowEnd: args.now,
    });
  }

  // Rule 3: rejected approvals spike.
  const rejectedApprovals = args.tasks.filter((task) =>
    task.approvalStatus === TaskApprovalStatus.rejected
    && task.updatedAt >= window48h,
  );
  const rejectionsByTarget = groupByKey(rejectedApprovals, (task) => {
    if (task.homeId) return keyForTarget({ targetType: 'home', targetId: task.homeId });
    return keyForTarget({ targetType: 'tenant', targetId: args.tenantId });
  });

  for (const [targetKey, items] of Object.entries(rejectionsByTarget)) {
    if (items.length < 2) continue;
    const [targetType, targetId] = targetKey.split(':') as [RiskAlertTargetType, string];
    const severity: RiskAlertSeverity = items.length >= 4 ? 'critical' : 'high';
    const label = items[0]?.home?.name ?? 'tenant scope';

    candidates.push({
      type: 'rejected_approval_spike',
      severity,
      targetType,
      targetId,
      homeId: items[0]?.homeId ?? null,
      youngPersonId: null,
      ruleKey: 'rejected_approval_spike',
      dedupeKey: `rejected_approval_spike:${targetType}:${targetId}`,
      title: `Rejected approvals spike (${label})`,
      description: `${items.length} approval rejections were recorded in the last 48 hours for ${label}.`,
      evidence: {
        rejectedCount: items.length,
        threshold: 2,
        windowHours: 48,
        taskIds: items.map((task) => task.id),
        tasks: items.slice(0, 12).map((task) => ({
          taskId: task.id,
          title: task.title,
          updatedAt: task.updatedAt.toISOString(),
          route: `/tasks?taskId=${task.id}`,
        })),
      },
      windowStart: window48h,
      windowEnd: args.now,
    });
  }

  // Rule 4: overdue high-priority tasks backlog.
  const overdueHighPriority = args.tasks.filter((task) => isOverdueHighPriorityTask(task, args.now));
  const overdueByTarget = groupByKey(overdueHighPriority, (task) => {
    if (task.homeId) return keyForTarget({ targetType: 'home', targetId: task.homeId });
    return keyForTarget({ targetType: 'tenant', targetId: args.tenantId });
  });

  for (const [targetKey, items] of Object.entries(overdueByTarget)) {
    if (items.length < 3) continue;
    const [targetType, targetId] = targetKey.split(':') as [RiskAlertTargetType, string];
    const urgentCount = items.filter((task) => task.priority === TaskPriority.urgent).length;
    const severity: RiskAlertSeverity = urgentCount >= 2 || items.length >= 6 ? 'critical' : 'high';
    const earliestDueDate = items
      .map((task) => task.dueDate)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? window7d;
    const label = items[0]?.home?.name ?? 'tenant scope';

    candidates.push({
      type: 'overdue_high_priority_tasks',
      severity,
      targetType,
      targetId,
      homeId: items[0]?.homeId ?? null,
      youngPersonId: null,
      ruleKey: 'overdue_high_priority_tasks',
      dedupeKey: `overdue_high_priority_tasks:${targetType}:${targetId}`,
      title: `Overdue high-priority tasks (${label})`,
      description: `${items.length} high-priority tasks are overdue and unresolved in ${label}.`,
      evidence: {
        overdueCount: items.length,
        threshold: 3,
        urgentCount,
        taskIds: items.map((task) => task.id),
        tasks: items.slice(0, 20).map((task) => ({
          taskId: task.id,
          title: task.title,
          priority: task.priority,
          dueDate: task.dueDate?.toISOString() ?? null,
          route: `/tasks?taskId=${task.id}`,
        })),
      },
      windowStart: earliestDueDate,
      windowEnd: args.now,
    });
  }

  // Rule 5: critical home event signal.
  const signalingHomeEvents = args.homeEvents.filter((event) => {
    if (event.startsAt < window72h) return false;
    const haystack = `${event.title} ${event.description ?? ''}`;
    return hasCriticalHomeEventTerm(haystack) || hasHighHomeEventTerm(haystack);
  });
  const homeEventsByHome = groupByKey(signalingHomeEvents, (event) => event.homeId);

  for (const [homeId, items] of Object.entries(homeEventsByHome)) {
    if (!homeId || items.length < 1) continue;
    const hasCriticalTerm = items.some((event) => hasCriticalHomeEventTerm(`${event.title} ${event.description ?? ''}`));
    const severity: RiskAlertSeverity = hasCriticalTerm ? 'critical' : 'high';
    const label = items[0]?.home?.name ?? 'home';

    candidates.push({
      type: 'critical_home_event_signal',
      severity,
      targetType: 'home',
      targetId: homeId,
      homeId,
      youngPersonId: null,
      ruleKey: 'critical_home_event_signal',
      dedupeKey: `critical_home_event_signal:home:${homeId}`,
      title: `Critical home event signal (${label})`,
      description: `${items.length} recent home event(s) in ${label} include potential safeguarding escalation language.`,
      evidence: {
        eventCount: items.length,
        windowHours: 72,
        eventIds: items.map((event) => event.id),
        events: items.slice(0, 10).map((event) => ({
          eventId: event.id,
          title: event.title,
          description: compactText(event.description, 240),
          startsAt: event.startsAt.toISOString(),
          route: `/homes/${event.homeId}/events`,
        })),
      },
      windowStart: window72h,
      windowEnd: args.now,
    });
  }

  return candidates;
}

async function loadRiskEvidence(args: {
  tenantId: string;
  now: Date;
  lookbackFrom: Date;
  homeId?: string | undefined;
  youngPersonId?: string | undefined;
}) {
  let scopedHomeId = args.homeId;

  if (args.youngPersonId) {
    const youngPerson = await prisma.youngPerson.findFirst({
      where: {
        id: args.youngPersonId,
        tenantId: args.tenantId,
      },
      select: {
        id: true,
        homeId: true,
      },
    });

    if (!youngPerson) {
      throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found in tenant scope.');
    }

    scopedHomeId = youngPerson.homeId;
  }

  const tasks = await prisma.task.findMany({
    where: buildTaskWhere({
      tenantId: args.tenantId,
      now: args.now,
      lookbackFrom: args.lookbackFrom,
      homeId: scopedHomeId,
      youngPersonId: args.youngPersonId,
    }),
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      status: true,
      approvalStatus: true,
      priority: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      homeId: true,
      youngPersonId: true,
      home: { select: { id: true, name: true } },
      youngPerson: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  const homeEventsWhere: Prisma.HomeEventWhereInput = {
    tenantId: args.tenantId,
    startsAt: {
      gte: args.lookbackFrom,
      lte: args.now,
    },
  };

  if (scopedHomeId) {
    homeEventsWhere.homeId = scopedHomeId;
  }

  const homeEvents = await prisma.homeEvent.findMany({
    where: homeEventsWhere,
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      homeId: true,
      home: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: 'desc' },
    take: 1000,
  });

  return { tasks, homeEvents };
}

async function routeAlert(args: {
  alert: AlertSelect;
  reason: 'created' | 'reopened' | 'severity_raised';
  sendEmailHooks: boolean;
}) {
  try {
    const memberships = await prisma.tenantMembership.findMany({
      where: {
        tenantId: args.alert.tenantId,
        status: MembershipStatus.active,
        role: { in: [TenantRole.tenant_admin, TenantRole.sub_admin] },
      },
      select: {
        userId: true,
      },
    });
    const recipientUserIds = [...new Set(memberships.map((item) => item.userId))];

    if (recipientUserIds.length > 0) {
      void emitNotification({
        level: 'tenant',
        category: 'general',
        tenantId: args.alert.tenantId,
        title: `Safeguarding risk: ${args.alert.title}`,
        body: args.alert.description,
        metadata: {
          source: 'safeguarding-risk-alerts',
          alertId: args.alert.id,
          alertType: args.alert.type,
          severity: args.alert.severity,
          status: args.alert.status,
          reason: args.reason,
          targetType: args.alert.targetType,
          targetId: args.alert.targetId,
        },
        recipientUserIds,
      });

      if (args.sendEmailHooks) {
        const users = await prisma.user.findMany({
          where: {
            id: { in: recipientUserIds },
            isActive: true,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
          },
          take: 20,
        });

        await Promise.allSettled(users.map((user) =>
          sendSafeguardingRiskAlertEmail({
            to: user.email,
            firstName: user.firstName,
            alert: {
              id: args.alert.id,
              type: args.alert.type,
              severity: args.alert.severity,
              title: args.alert.title,
              description: args.alert.description,
              targetType: args.alert.targetType,
              targetId: args.alert.targetId,
              reason: args.reason,
            },
          }),
        ));
      }
    }

    await emitWebhookEvent({
      tenantId: args.alert.tenantId,
      eventType: 'safeguarding_risk_alert',
      payload: {
        action: args.reason,
        alert: {
          id: args.alert.id,
          type: args.alert.type,
          severity: args.alert.severity,
          status: args.alert.status,
          targetType: args.alert.targetType,
          targetId: args.alert.targetId,
          title: args.alert.title,
          description: args.alert.description,
          evidence: args.alert.evidence,
          firstTriggeredAt: args.alert.firstTriggeredAt.toISOString(),
          lastTriggeredAt: args.alert.lastTriggeredAt.toISOString(),
          triggeredCount: args.alert.triggeredCount,
        },
      },
    });
  } catch (error) {
    logger.error({
      err: error,
      alertId: args.alert.id,
      reason: args.reason,
    }, 'Failed to route safeguarding risk alert.');
  }
}

export async function evaluateRiskAlertsForTenant(args: EvaluateRiskArgs) {
  const now = new Date();
  const lookbackHours = args.lookbackHours ?? 24 * 7;
  const lookbackFrom = new Date(now.getTime() - lookbackHours * 60 * 60 * 1_000);
  const retentionFrom = retentionCutoff(now);

  const { tasks, homeEvents } = await loadRiskEvidence({
    tenantId: args.tenantId,
    now,
    lookbackFrom,
    homeId: args.homeId,
    youngPersonId: args.youngPersonId,
  });

  const candidates = buildRiskCandidates({
    tenantId: args.tenantId,
    tasks,
    homeEvents,
    now,
  });

  const existing = await prisma.safeguardingRiskAlert.findMany({
    where: {
      tenantId: args.tenantId,
      createdAt: { gte: retentionFrom },
      dedupeKey: { in: candidates.map((candidate) => candidate.dedupeKey) },
    },
    select: {
      id: true,
      dedupeKey: true,
      severity: true,
      status: true,
      triggeredCount: true,
      ownerUserId: true,
      firstTriggeredAt: true,
    },
  });

  const existingByKey = new Map(existing.map((alert) => [alert.dedupeKey, alert]));

  const created: AlertSelect[] = [];
  const reopened: AlertSelect[] = [];
  const severityRaised: AlertSelect[] = [];
  let updatedCount = 0;

  for (const candidate of candidates) {
    const matched = existingByKey.get(candidate.dedupeKey);

    if (!matched) {
      const createdAlert = await prisma.safeguardingRiskAlert.create({
        data: {
          tenantId: args.tenantId,
          type: candidate.type,
          severity: candidate.severity,
          status: SafeguardingRiskAlertStatus.new,
          targetType: candidate.targetType,
          targetId: candidate.targetId,
          homeId: candidate.homeId,
          youngPersonId: candidate.youngPersonId,
          ruleKey: candidate.ruleKey,
          dedupeKey: candidate.dedupeKey,
          title: candidate.title,
          description: candidate.description,
          evidence: candidate.evidence,
          windowStart: candidate.windowStart,
          windowEnd: candidate.windowEnd,
          firstTriggeredAt: now,
          lastTriggeredAt: now,
          triggeredCount: 1,
          lastEvaluatedAt: now,
        },
        select: {
          id: true,
          tenantId: true,
          type: true,
          severity: true,
          status: true,
          targetType: true,
          targetId: true,
          homeId: true,
          youngPersonId: true,
          ruleKey: true,
          dedupeKey: true,
          title: true,
          description: true,
          evidence: true,
          windowStart: true,
          windowEnd: true,
          firstTriggeredAt: true,
          lastTriggeredAt: true,
          triggeredCount: true,
          ownerUserId: true,
          acknowledgedById: true,
          acknowledgedAt: true,
          resolvedById: true,
          resolvedAt: true,
          lastEvaluatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      created.push(createdAlert);
      continue;
    }

    const previousSeverityRank = RISK_SEVERITY_RANK[matched.severity as RiskAlertSeverity];
    const nextSeverityRank = RISK_SEVERITY_RANK[candidate.severity];
    const isSeverityRaised = nextSeverityRank > previousSeverityRank;
    const wasResolved = matched.status === SafeguardingRiskAlertStatus.resolved;

    const updatedAlert = await prisma.safeguardingRiskAlert.update({
      where: { id: matched.id },
      data: {
        type: candidate.type,
        severity: candidate.severity,
        title: candidate.title,
        description: candidate.description,
        targetType: candidate.targetType,
        targetId: candidate.targetId,
        homeId: candidate.homeId,
        youngPersonId: candidate.youngPersonId,
        ruleKey: candidate.ruleKey,
        evidence: candidate.evidence,
        windowStart: candidate.windowStart,
        windowEnd: candidate.windowEnd,
        lastTriggeredAt: now,
        triggeredCount: matched.triggeredCount + 1,
        lastEvaluatedAt: now,
        ...(wasResolved
          ? {
              status: SafeguardingRiskAlertStatus.new,
              acknowledgedById: null,
              acknowledgedAt: null,
              resolvedById: null,
              resolvedAt: null,
            }
          : {}),
      },
      select: {
        id: true,
        tenantId: true,
        type: true,
        severity: true,
        status: true,
        targetType: true,
        targetId: true,
        homeId: true,
        youngPersonId: true,
        ruleKey: true,
        dedupeKey: true,
        title: true,
        description: true,
        evidence: true,
        windowStart: true,
        windowEnd: true,
        firstTriggeredAt: true,
        lastTriggeredAt: true,
        triggeredCount: true,
        ownerUserId: true,
        acknowledgedById: true,
        acknowledgedAt: true,
        resolvedById: true,
        resolvedAt: true,
        lastEvaluatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    updatedCount += 1;
    if (wasResolved) reopened.push(updatedAlert);
    if (isSeverityRaised) severityRaised.push(updatedAlert);
  }

  const routeQueue: Array<{ alert: AlertSelect; reason: 'created' | 'reopened' | 'severity_raised' }> = [
    ...created.map((alert) => ({ alert, reason: 'created' as const })),
    ...reopened.map((alert) => ({ alert, reason: 'reopened' as const })),
    ...severityRaised.map((alert) => ({ alert, reason: 'severity_raised' as const })),
  ];

  for (const item of routeQueue) {
    await routeAlert({
      alert: item.alert,
      reason: item.reason,
      sendEmailHooks: Boolean(args.sendEmailHooks),
    });
  }

  return {
    evaluatedAt: now.toISOString(),
    mode: args.mode,
    lookbackHours,
    totalCandidates: candidates.length,
    createdCount: created.length,
    reopenedCount: reopened.length,
    updatedCount,
    severityRaisedCount: severityRaised.length,
    routedCount: routeQueue.length,
  };
}

export async function runScheduledRiskBackfill(
  args: ScheduledRiskBackfillArgs = {},
): Promise<ScheduledRiskBackfillSummary> {
  const startedAt = new Date();

  const tenants = await prisma.tenant.findMany({
    where: {
      isActive: true,
      ...(args.tenantIds && args.tenantIds.length > 0 ? { id: { in: args.tenantIds } } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let succeededCount = 0;
  let failedCount = 0;
  const failedTenantIds: string[] = [];
  let totalCandidates = 0;
  let createdCount = 0;
  let reopenedCount = 0;
  let updatedCount = 0;
  let severityRaisedCount = 0;
  let routedCount = 0;

  for (const tenant of tenants) {
    try {
      const evaluateArgs: EvaluateRiskArgs = {
        tenantId: tenant.id,
        mode: 'scheduled',
        ...(args.lookbackHours !== undefined ? { lookbackHours: args.lookbackHours } : {}),
        ...(args.sendEmailHooks !== undefined ? { sendEmailHooks: args.sendEmailHooks } : {}),
      };
      const summary = await evaluateRiskAlertsForTenant(evaluateArgs);
      succeededCount += 1;
      totalCandidates += summary.totalCandidates;
      createdCount += summary.createdCount;
      reopenedCount += summary.reopenedCount;
      updatedCount += summary.updatedCount;
      severityRaisedCount += summary.severityRaisedCount;
      routedCount += summary.routedCount;
    } catch (error) {
      failedCount += 1;
      failedTenantIds.push(tenant.id);
      logger.error(
        { err: error, tenantId: tenant.id },
        'Scheduled safeguarding risk evaluation failed for tenant.',
      );
    }
  }

  return {
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    tenantCount: tenants.length,
    succeededCount,
    failedCount,
    failedTenantIds,
    totalCandidates,
    createdCount,
    reopenedCount,
    updatedCount,
    severityRaisedCount,
    routedCount,
  };
}

export async function triggerRiskEvaluationForTaskMutation(args: {
  tenantId: string;
  homeId: string | null;
  youngPersonId: string | null;
  actorUserId?: string | null;
}) {
  if (!canEvaluateRiskAlerts()) return;
  try {
    await evaluateRiskAlertsForTenant({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      homeId: args.homeId ?? undefined,
      youngPersonId: args.youngPersonId ?? undefined,
      mode: 'event',
      sendEmailHooks: false,
    });
  } catch (error) {
    logger.error({ err: error, tenantId: args.tenantId }, 'Task-triggered safeguarding risk evaluation failed.');
  }
}

export async function triggerRiskEvaluationForHomeEventMutation(args: {
  tenantId: string;
  homeId: string;
  actorUserId?: string | null;
}) {
  if (!canEvaluateRiskAlerts()) return;
  try {
    await evaluateRiskAlertsForTenant({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      homeId: args.homeId,
      mode: 'event',
      sendEmailHooks: false,
    });
  } catch (error) {
    logger.error({ err: error, tenantId: args.tenantId }, 'Home-event-triggered safeguarding risk evaluation failed.');
  }
}

async function getAlertInTenant(tenantId: string, alertId: string): Promise<AlertWithNotes> {
  const alert = await prisma.safeguardingRiskAlert.findFirst({
    where: {
      id: alertId,
      tenantId,
      createdAt: { gte: retentionCutoff() },
    },
    include: {
      notes: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!alert) {
    throw httpError(404, 'RISK_ALERT_NOT_FOUND', 'Safeguarding risk alert not found.');
  }

  return alert;
}

async function updateRiskAlertStatus(args: {
  actor: SafeguardingActorContext;
  alertId: string;
  toStatus: RiskAlertStatus;
  body: UpdateRiskAlertStateBody;
}) {
  const current = await getAlertInTenant(args.actor.tenantId, args.alertId);

  if (args.body.ownerUserId) {
    await assertOwnerWithinTenant(args.actor.tenantId, args.body.ownerUserId);
  }

  const updateData: Prisma.SafeguardingRiskAlertUncheckedUpdateInput = {
    status: args.toStatus as SafeguardingRiskAlertStatus,
  };
  if (args.body.ownerUserId !== undefined) {
    updateData.ownerUserId = args.body.ownerUserId;
  }

  if (args.toStatus === 'acknowledged') {
    updateData.acknowledgedAt = new Date();
    updateData.acknowledgedById = args.actor.userId;
  }

  if (args.toStatus === 'in_progress') {
    if (!current.acknowledgedAt) {
      updateData.acknowledgedAt = new Date();
      updateData.acknowledgedById = args.actor.userId;
    }
  }

  if (args.toStatus === 'resolved') {
    updateData.resolvedAt = new Date();
    updateData.resolvedById = args.actor.userId;
  } else {
    updateData.resolvedAt = null;
    updateData.resolvedById = null;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const alert = await tx.safeguardingRiskAlert.update({
      where: { id: args.alertId },
      data: updateData,
      include: {
        notes: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (args.body.note) {
      await tx.safeguardingRiskAlertNote.create({
        data: {
          alertId: args.alertId,
          tenantId: args.actor.tenantId,
          userId: args.actor.userId,
          note: args.body.note,
          isEscalation: false,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        tenantId: args.actor.tenantId,
        userId: args.actor.userId,
        action: 'record_updated',
        entityType: 'safeguarding_risk_alert',
        entityId: args.alertId,
        metadata: {
          statusFrom: current.status,
          statusTo: args.toStatus,
          ownerUserId: args.body.ownerUserId ?? current.ownerUserId,
          noteAdded: Boolean(args.body.note),
        },
      },
    });

    return alert;
  });

  await emitWebhookEvent({
    tenantId: args.actor.tenantId,
    eventType: 'safeguarding_risk_alert_updated',
    payload: {
      action: 'status_changed',
      alert: {
        id: updated.id,
        status: updated.status,
        severity: updated.severity,
        type: updated.type,
        ownerUserId: updated.ownerUserId,
      },
      previousStatus: current.status,
      note: args.body.note ?? null,
    },
  });

  if (args.body.sendEmailHooks) {
    await routeAlert({
      alert: updated as unknown as AlertSelect,
      reason: 'severity_raised',
      sendEmailHooks: true,
    });
  }

  const refreshed = await getAlertInTenant(args.actor.tenantId, args.alertId);
  return mapAlert(refreshed, refreshed.notes);
}

export async function listRiskRules(actorUserId: string) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);
  return SAFEGUARDING_RISK_RULES;
}

export async function listRiskAlerts(actorUserId: string, query: ListRiskAlertsQuery) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);
  const confidentiality = resolveConfidentialityScope({
    actor,
    requestedScope: query.confidentialityScope,
  });
  const retentionFrom = retentionCutoff();

  const where: Prisma.SafeguardingRiskAlertWhereInput = {
    tenantId: actor.tenantId,
    createdAt: { gte: retentionFrom },
  };

  if (query.status) where.status = query.status as SafeguardingRiskAlertStatus;
  if (query.severity) where.severity = query.severity as SafeguardingRiskAlertSeverity;
  if (query.type) where.type = query.type as SafeguardingRiskAlertType;
  if (query.targetType) where.targetType = query.targetType as SafeguardingRiskAlertTargetType;
  if (query.targetId) where.targetId = query.targetId;
  if (query.ownerUserId) where.ownerUserId = query.ownerUserId;

  const findManyArgs: Prisma.SafeguardingRiskAlertFindManyArgs = {
    where,
    orderBy: [
      { severity: 'desc' },
      { lastTriggeredAt: 'desc' },
    ],
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };

  if (query.includeNotes) {
    findManyArgs.include = {
      notes: {
        orderBy: { createdAt: 'asc' },
      },
    };
  }

  const [total, rows] = await Promise.all([
    prisma.safeguardingRiskAlert.count({ where }),
    prisma.safeguardingRiskAlert.findMany(findManyArgs),
  ]);

  const data = rows.map((row) =>
    mapAlert(
      row as AlertSelect,
      query.includeNotes ? (row as AlertWithNotes).notes : [],
      confidentiality.effectiveScope,
    ));

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'record_accessed',
      entityType: 'safeguarding_risk_alert',
      metadata: {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status ?? null,
        severity: query.severity ?? null,
        type: query.type ?? null,
        targetType: query.targetType ?? null,
        confidentialityScope: confidentiality.effectiveScope,
        hasTargetId: Boolean(query.targetId),
      },
    },
  });

  return {
    data,
    meta: {
      ...paginationMeta(total, query.page, query.pageSize),
      retentionPolicyDays: riskAlertRetentionDays(),
      retentionFrom: retentionFrom.toISOString(),
      confidentiality,
    },
  };
}

export async function getRiskAlert(actorUserId: string, alertId: string, query?: RiskAlertDetailQuery) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);
  const confidentiality = resolveConfidentialityScope({
    actor,
    requestedScope: query?.confidentialityScope,
  });

  const alert = await getAlertInTenant(actor.tenantId, alertId);

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'record_accessed',
      entityType: 'safeguarding_risk_alert',
      entityId: alertId,
      metadata: {
        confidentialityScope: confidentiality.effectiveScope,
      },
    },
  });

  return mapAlert(alert, alert.notes, confidentiality.effectiveScope);
}

export async function evaluateRiskAlerts(actorUserId: string, body: EvaluateRiskAlertsBody) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);

  const result = await evaluateRiskAlertsForTenant({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    homeId: body.homeId,
    youngPersonId: body.youngPersonId,
    lookbackHours: body.lookbackHours,
    mode: body.mode,
    sendEmailHooks: body.sendEmailHooks,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'record_updated',
      entityType: 'safeguarding_risk_alert',
      metadata: {
        event: 'risk_alert_evaluation',
        ...result,
        homeId: body.homeId ?? null,
        youngPersonId: body.youngPersonId ?? null,
      },
    },
  });

  return {
    ...result,
    rules: SAFEGUARDING_RISK_RULES,
  };
}

export async function acknowledgeRiskAlert(
  actorUserId: string,
  alertId: string,
  body: UpdateRiskAlertStateBody,
) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);

  return updateRiskAlertStatus({
    actor,
    alertId,
    toStatus: 'acknowledged',
    body,
  });
}

export async function markRiskAlertInProgress(
  actorUserId: string,
  alertId: string,
  body: UpdateRiskAlertStateBody,
) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);

  return updateRiskAlertStatus({
    actor,
    alertId,
    toStatus: 'in_progress',
    body,
  });
}

export async function resolveRiskAlert(
  actorUserId: string,
  alertId: string,
  body: UpdateRiskAlertStateBody,
) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);

  return updateRiskAlertStatus({
    actor,
    alertId,
    toStatus: 'resolved',
    body,
  });
}

export async function createRiskAlertNote(
  actorUserId: string,
  alertId: string,
  body: CreateRiskAlertNoteBody,
) {
  const actor = await resolveSafeguardingActor(actorUserId);
  assertRiskAlertViewer(actor);

  const alert = await getAlertInTenant(actor.tenantId, alertId);

  await prisma.safeguardingRiskAlertNote.create({
    data: {
      alertId,
      tenantId: actor.tenantId,
      userId: actor.userId,
      note: body.note,
      isEscalation: body.isEscalation,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'record_updated',
      entityType: 'safeguarding_risk_alert',
      entityId: alertId,
      metadata: {
        event: 'risk_alert_note_created',
        isEscalation: body.isEscalation,
      },
    },
  });

  await emitWebhookEvent({
    tenantId: actor.tenantId,
    eventType: 'safeguarding_risk_alert_updated',
    payload: {
      action: 'note_added',
      alert: {
        id: alert.id,
        status: alert.status,
        severity: alert.severity,
        type: alert.type,
      },
      note: {
        text: body.note,
        isEscalation: body.isEscalation,
      },
    },
  });

  if (body.sendEmailHooks && body.isEscalation) {
    await routeAlert({
      alert: alert as unknown as AlertSelect,
      reason: 'severity_raised',
      sendEmailHooks: true,
    });
  }

  const refreshed = await getAlertInTenant(actor.tenantId, alertId);
  return mapAlert(refreshed, refreshed.notes);
}
