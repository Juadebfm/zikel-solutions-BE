import {
  AuditAction,
  Prisma,
  TenantRole,
  TaskApprovalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import {
  canUseRestrictedConfidentialityScope,
  maskIdentifier,
  redactPersonName,
  redactSensitiveText,
  type ConfidentialityScope,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  ChronologyEventType,
  ChronologyQuery,
  ChronologySeverity,
  ChronologySource,
  ReflectivePromptChildProfile,
  ReflectivePromptContextCategory,
  ReflectivePromptIncidentType,
  ReflectivePromptQuery,
  ReflectivePromptSafeguardingClass,
  SaveReflectivePromptResponsesBody,
} from './safeguarding.schema.js';

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_TIMEOUT_MS = 12_000;
const CHRONOLOGY_NARRATIVE_QA_VERSION = 'chronology-empathy-v1';

const CHRONOLOGY_NON_BLAMING_PATTERNS = [
  /\bnon[-\s]?compliant\b/i,
  /\battention[-\s]?seeking\b/i,
  /\bmanipulative\b/i,
  /\bdifficult child\b/i,
  /\bbad behavio[u]?r\b/i,
  /\bdefiant\b/i,
];

const ACTIVE_TASK_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function chronologyRetentionDays(): number {
  return parsePositiveInt(process.env.SAFEGUARDING_CHRONOLOGY_RETENTION_DAYS, 365, 30);
}

function defaultConfidentialityScope(): ConfidentialityScope {
  return process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE === 'restricted'
    ? 'restricted'
    : 'standard';
}

type ChronologyTargetType = 'young_person' | 'home';

type ChronologyTarget = {
  id: string;
  name: string;
  homeId: string | null;
  homeName: string | null;
};

type ChronologyWindow = {
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
};

type ChronologyEvent = {
  id: string;
  eventType: ChronologyEventType;
  source: ChronologySource;
  severity: ChronologySeverity;
  timestamp: string;
  title: string;
  description: string;
  linkage: {
    homeId: string | null;
    homeName: string | null;
    youngPersonId: string | null;
    youngPersonName: string | null;
  };
  evidenceRef: {
    source: ChronologySource;
    entityType: 'task' | 'home_event' | 'audit_log';
    entityId: string;
    taskId: string | null;
    route: string;
  };
};

type ChronologyNarrative = {
  source: 'model' | 'fallback';
  generatedAt: string;
  summary: string;
  keySignals: string[];
  recommendedActions: string[];
  evidenceReferences: string[];
  qualityChecks: {
    version: 'chronology-empathy-v1';
    childCentred: boolean;
    evidenceGrounded: boolean;
    nonBlamingLanguage: boolean;
    passed: boolean;
  };
};

export type ChronologyResponse = {
  targetType: ChronologyTargetType;
  target: ChronologyTarget;
  window: ChronologyWindow;
  retention: {
    policyDays: number;
    effectiveDateFrom: string;
    effectiveDateTo: string;
  };
  confidentiality: {
    requestedScope: ConfidentialityScope;
    effectiveScope: ConfidentialityScope;
  };
  filtersApplied: {
    eventType: ChronologyEventType | null;
    severity: ChronologySeverity | null;
    source: ChronologySource | null;
    confidentialityScope: ConfidentialityScope;
    maxEvents: number;
  };
  summary: {
    totalEvents: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    bySource: Record<string, number>;
    earliestAt: string | null;
    latestAt: string | null;
  };
  chronology: ChronologyEvent[];
  narrative: ChronologyNarrative | null;
};

type ResolvedConfidentiality = {
  requestedScope: ConfidentialityScope;
  effectiveScope: ConfidentialityScope;
};

type ScopeDescriptor = {
  targetType: ChronologyTargetType;
  target: ChronologyTarget;
  taskScopeWhere: Prisma.TaskWhereInput;
  homeIdForEvents: string;
  auditEntityIds: string[];
};

type ChronologyTaskRow = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    category: true;
    status: true;
    approvalStatus: true;
    priority: true;
    dueDate: true;
    approvedAt: true;
    submittedAt: true;
    createdAt: true;
    updatedAt: true;
    home: { select: { id: true; name: true } };
    youngPerson: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

type ChronologyAuditRow = Prisma.AuditLogGetPayload<{
  select: {
    id: true;
    action: true;
    entityType: true;
    entityId: true;
    metadata: true;
    createdAt: true;
    user: { select: { firstName: true; lastName: true } };
  };
}>;

type ChronologyHomeEventRow = Prisma.HomeEventGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    startsAt: true;
    homeId: true;
    home: { select: { id: true; name: true } };
  };
}>;

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseDateBoundary(raw: string | undefined, boundary: 'start' | 'end'): Date | null {
  if (!raw) return null;
  const normalized = raw.includes('T')
    ? raw
    : `${raw}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(422, 'VALIDATION_ERROR', `Invalid ${boundary === 'start' ? 'dateFrom' : 'dateTo'} value.`);
  }
  return parsed;
}

function resolveWindow(query: ChronologyQuery): { from: Date; to: Date; policyDays: number } {
  const now = new Date();
  const policyDays = chronologyRetentionDays();
  const retentionFrom = new Date(now.getTime() - policyDays * 24 * 60 * 60 * 1000);
  const fallbackFrom = new Date(now.getTime() - Math.min(DEFAULT_LOOKBACK_DAYS, policyDays) * 24 * 60 * 60 * 1000);
  const requestedFrom = parseDateBoundary(query.dateFrom, 'start') ?? fallbackFrom;
  const requestedTo = parseDateBoundary(query.dateTo, 'end') ?? now;
  const from = requestedFrom < retentionFrom ? retentionFrom : requestedFrom;
  const to = requestedTo > now ? now : requestedTo;
  if (from > to) {
    throw httpError(422, 'VALIDATION_ERROR', '`dateFrom` cannot be after `dateTo`.');
  }
  return { from, to, policyDays };
}

function resolveConfidentialityScope(args: {
  requestedScope: ConfidentialityScope | undefined;
  userRole: UserRole;
  tenantRole: TenantRole | null;
}): ResolvedConfidentiality {
  const defaultScope = defaultConfidentialityScope();
  const requestedScope = args.requestedScope ?? defaultScope;
  if (requestedScope === 'restricted') {
    const allowed = canUseRestrictedConfidentialityScope({
      userRole: args.userRole,
      tenantRole: args.tenantRole,
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

function toDisplayName(input: { firstName?: string | null; lastName?: string | null } | null): string | null {
  if (!input) return null;
  const full = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim();
  return full || null;
}

function compactText(input: string | null | undefined, max = 220): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function isOverdue(args: { dueDate: Date | null; status: TaskStatus }): boolean {
  if (!args.dueDate) return false;
  if (!ACTIVE_TASK_STATUSES.includes(args.status)) return false;
  return args.dueDate.getTime() < Date.now();
}

function severityForTask(args: {
  eventType: ChronologyEventType;
  priority: TaskPriority;
  status: TaskStatus;
  approvalStatus: TaskApprovalStatus;
  dueDate: Date | null;
}): ChronologySeverity {
  if (args.eventType === 'approval') {
    if (args.approvalStatus === TaskApprovalStatus.rejected) return 'high';
    if (args.approvalStatus === TaskApprovalStatus.pending_approval) return 'medium';
    return 'low';
  }

  if (args.eventType === 'incident') {
    if (args.priority === TaskPriority.urgent) return 'critical';
    if (args.priority === TaskPriority.high) return 'high';
    if (args.approvalStatus === TaskApprovalStatus.rejected) return 'high';
    if (isOverdue({ dueDate: args.dueDate, status: args.status })) return 'high';
    return 'medium';
  }

  if (args.eventType === 'daily_log') {
    if (args.approvalStatus === TaskApprovalStatus.rejected) return 'high';
    if (args.approvalStatus === TaskApprovalStatus.pending_approval) return 'medium';
    return 'low';
  }

  if (isOverdue({ dueDate: args.dueDate, status: args.status })) return 'high';
  if (args.priority === TaskPriority.urgent) return 'high';
  if (args.priority === TaskPriority.high) return 'medium';
  return args.eventType === 'note' ? 'low' : 'medium';
}

function severityForHomeEvent(input: { title: string; description: string | null }): ChronologySeverity {
  const text = `${input.title} ${input.description ?? ''}`.toLowerCase();
  if (
    text.includes('emergency') ||
    text.includes('safeguard') ||
    text.includes('missing') ||
    text.includes('injury') ||
    text.includes('police')
  ) {
    return 'high';
  }
  if (text.includes('urgent') || text.includes('incident')) return 'medium';
  return 'low';
}

function severityForAudit(action: AuditAction): ChronologySeverity {
  if (action === AuditAction.record_deleted || action === AuditAction.permission_changed) return 'high';
  if (action === AuditAction.record_accessed) return 'medium';
  return 'low';
}

function dedupeChronology(events: ChronologyEvent[]): ChronologyEvent[] {
  const seen = new Set<string>();
  const output: ChronologyEvent[] = [];
  for (const event of events) {
    const key = [
      event.eventType,
      event.source,
      event.evidenceRef.entityId,
      event.timestamp,
      event.title.trim().toLowerCase(),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

function sortChronology(events: ChronologyEvent[]): ChronologyEvent[] {
  return [...events].sort((a, b) => {
    const tsDelta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (tsDelta !== 0) return tsDelta;
    return a.eventType.localeCompare(b.eventType);
  });
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

function formatEventTypeLabel(value: ChronologyEventType): string {
  return value.replace(/_/g, ' ');
}

function aiConfig() {
  const parseBool = (raw: string | undefined) => raw === 'true' || raw === '1';
  const parsePositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  };
  return {
    enabled: parseBool(process.env.AI_ENABLED),
    apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    timeoutMs: parsePositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS),
  };
}

function applyChronologyNonBlamingLanguage(text: string): string {
  return text
    .replace(/\bnon[-\s]?compliant\b/gi, 'finding it hard to engage')
    .replace(/\battention[-\s]?seeking\b/gi, 'seeking connection or support')
    .replace(/\bmanipulative\b/gi, 'using coping strategies to regain control')
    .replace(/\bdifficult child\b/gi, 'child with unmet needs')
    .replace(/\bbad behavio[u]?r\b/gi, 'distressed behaviour')
    .replace(/\bdefiant\b/gi, 'showing resistance')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function evaluateChronologyNarrativeQuality(args: {
  summary: string;
  targetType: ChronologyTargetType;
  targetName: string;
  evidenceReferences: string[];
}): ChronologyNarrative['qualityChecks'] {
  const summaryLower = args.summary.toLowerCase();
  const childCentred =
    args.targetType === 'home'
      ? true
      : /\bchild|young person\b/i.test(summaryLower) || summaryLower.includes(args.targetName.toLowerCase());

  const hasEvidenceCue =
    /\bevidence\b/i.test(summaryLower) ||
    /\bref\b/i.test(summaryLower) ||
    /\(\s*[a-z0-9_-]{5,}\s*\)/i.test(summaryLower);
  const evidenceGrounded =
    args.evidenceReferences.length === 0 ? true : hasEvidenceCue;

  const nonBlamingLanguage = CHRONOLOGY_NON_BLAMING_PATTERNS.every((pattern) => !pattern.test(summaryLower));

  return {
    version: CHRONOLOGY_NARRATIVE_QA_VERSION,
    childCentred,
    evidenceGrounded,
    nonBlamingLanguage,
    passed: childCentred && evidenceGrounded && nonBlamingLanguage,
  };
}

function buildFallbackNarrative(args: {
  targetType: ChronologyTargetType;
  targetName: string;
  chronology: ChronologyEvent[];
}): ChronologyNarrative {
  const byType = countBy(args.chronology.map((event) => event.eventType));
  const bySeverity = countBy(args.chronology.map((event) => event.severity));
  const highAndCritical = (bySeverity.high ?? 0) + (bySeverity.critical ?? 0);
  const incidentCount = byType.incident ?? 0;
  const approvalCount = byType.approval ?? 0;
  const dailyLogCount = byType.daily_log ?? 0;

  const evidenceReferences = [
    ...new Set(args.chronology.map((event) => event.evidenceRef.entityId)),
  ].slice(0, 8);

  const keySignals: string[] = [];
  if (highAndCritical > 0) {
    keySignals.push(`${highAndCritical} high-severity safeguarding signal(s) recorded in this timeline.`);
  }
  if (incidentCount > 0) {
    keySignals.push(`${incidentCount} incident event(s) captured with linked evidence references.`);
  }
  if (approvalCount > 0) {
    keySignals.push(`${approvalCount} approval-stage event(s) show oversight and sign-off activity.`);
  }
  if (dailyLogCount > 0) {
    keySignals.push(`${dailyLogCount} daily log event(s) provide day-to-day context.`);
  }
  if (keySignals.length === 0) {
    keySignals.push('No material safeguarding events were found in the selected period.');
  }

  const recommendedActions: string[] = [];
  if (highAndCritical > 0) {
    recommendedActions.push('Review high-severity items first and confirm immediate safeguarding controls are in place.');
  }
  if (approvalCount > 0) {
    recommendedActions.push('Check pending/rejected approvals and capture corrective evidence promptly.');
  }
  recommendedActions.push('Use referenced evidence IDs to verify chronology accuracy before external reporting.');

  const subject = args.targetType === 'young_person' ? `for ${args.targetName}` : `across ${args.targetName}`;
  const summary = applyChronologyNonBlamingLanguage([
    `This safeguarding chronology ${subject} is evidence-linked and ordered by time.`,
    `It includes ${args.chronology.length} event(s), with ${highAndCritical} high/critical signal(s).`,
    `Focus on immediate safety follow-up, then complete outstanding oversight actions while keeping records child-centred and non-blaming.`,
  ].join(' '));
  const qualityChecks = evaluateChronologyNarrativeQuality({
    summary,
    targetType: args.targetType,
    targetName: args.targetName,
    evidenceReferences,
  });

  return {
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    summary,
    keySignals: keySignals.slice(0, 4),
    recommendedActions: recommendedActions.slice(0, 4),
    evidenceReferences,
    qualityChecks,
  };
}

async function generateModelNarrative(args: {
  targetType: ChronologyTargetType;
  targetName: string;
  chronology: ChronologyEvent[];
  fallback: ChronologyNarrative;
}): Promise<ChronologyNarrative | null> {
  const cfg = aiConfig();
  if (!cfg.enabled || !cfg.apiKey || args.chronology.length === 0) return null;

  const condensed = args.chronology.slice(-24).map((event) => ({
    id: event.id,
    eventType: event.eventType,
    severity: event.severity,
    timestamp: event.timestamp,
    title: event.title,
    evidenceId: event.evidenceRef.entityId,
  }));

  const systemPrompt =
    'You are a safeguarding assistant for children-home teams. ' +
    'Write a concise, child-centred narrative with non-blaming language. ' +
    'Ground statements in provided evidence references only. ' +
    'Do not infer diagnoses or legal conclusions.';

  const userPrompt = JSON.stringify(
    {
      request: 'Generate safeguarding chronology narrative',
      targetType: args.targetType,
      targetName: args.targetName,
      events: condensed,
      guidance: [
        'Mention major patterns and immediate priorities.',
        'Reference evidence IDs inline in parentheses when relevant.',
        'Keep response under 180 words.',
      ],
    },
    null,
    2,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    const summary = applyChronologyNonBlamingLanguage(content.trim());
    const qualityChecks = evaluateChronologyNarrativeQuality({
      summary,
      targetType: args.targetType,
      targetName: args.targetName,
      evidenceReferences: args.fallback.evidenceReferences,
    });

    if (!qualityChecks.passed) {
      return null;
    }

    return {
      ...args.fallback,
      source: 'model',
      generatedAt: new Date().toISOString(),
      summary,
      qualityChecks,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildNarrative(args: {
  includeNarrative: boolean;
  targetType: ChronologyTargetType;
  targetName: string;
  chronology: ChronologyEvent[];
}): Promise<ChronologyNarrative | null> {
  if (!args.includeNarrative) return null;

  const fallback = buildFallbackNarrative({
    targetType: args.targetType,
    targetName: args.targetName,
    chronology: args.chronology,
  });
  const model = await generateModelNarrative({
    targetType: args.targetType,
    targetName: args.targetName,
    chronology: args.chronology,
    fallback,
  });
  return model ?? fallback;
}

function toScopeLinkage(target: ChronologyTarget) {
  return {
    homeId: target.homeId,
    homeName: target.homeName,
    youngPersonId: null,
    youngPersonName: null,
  };
}

function mapTaskEvents(args: {
  tasks: ChronologyTaskRow[];
  scope: ScopeDescriptor;
}): ChronologyEvent[] {
  const events: ChronologyEvent[] = [];

  for (const task of args.tasks) {
    const youngPersonName = task.youngPerson ? toDisplayName(task.youngPerson) : null;
    const linkage = {
      homeId: task.home?.id ?? args.scope.target.homeId,
      homeName: task.home?.name ?? args.scope.target.homeName,
      youngPersonId: task.youngPerson?.id ?? null,
      youngPersonName,
    };

    const taskTimestamp = asIso(task.submittedAt ?? task.updatedAt ?? task.createdAt);
    const inferredEventType: ChronologyEventType =
      task.category === TaskCategory.incident
        ? 'incident'
        : task.category === TaskCategory.daily_log
          ? 'daily_log'
          : task.category === TaskCategory.task_log
            ? 'note'
            : 'task';

    events.push({
      id: `tasks:${task.id}:${inferredEventType}:${taskTimestamp}`,
      eventType: inferredEventType,
      source: 'tasks',
      severity: severityForTask({
        eventType: inferredEventType,
        priority: task.priority,
        status: task.status,
        approvalStatus: task.approvalStatus,
        dueDate: task.dueDate,
      }),
      timestamp: taskTimestamp,
      title: task.title,
      description: compactText(task.description) || `${formatEventTypeLabel(inferredEventType)} recorded.`,
      linkage,
      evidenceRef: {
        source: 'tasks',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        route: `/tasks/${task.id}`,
      },
    });

    if (task.approvalStatus !== TaskApprovalStatus.not_required) {
      const approvalTimestamp = asIso(task.approvedAt ?? task.updatedAt ?? task.createdAt);
      events.push({
        id: `tasks:${task.id}:approval:${approvalTimestamp}`,
        eventType: 'approval',
        source: 'tasks',
        severity: severityForTask({
          eventType: 'approval',
          priority: task.priority,
          status: task.status,
          approvalStatus: task.approvalStatus,
          dueDate: task.dueDate,
        }),
        timestamp: approvalTimestamp,
        title: `Approval ${task.approvalStatus.replace(/_/g, ' ')} — ${task.title}`,
        description: `Task approval status is ${task.approvalStatus.replace(/_/g, ' ')}.`,
        linkage,
        evidenceRef: {
          source: 'tasks',
          entityType: 'task',
          entityId: task.id,
          taskId: task.id,
          route: `/summary/tasks-to-approve/${task.id}`,
        },
      });
    }
  }

  return events;
}

function mapHomeEventEvents(args: {
  homeEvents: ChronologyHomeEventRow[];
  scope: ScopeDescriptor;
}): ChronologyEvent[] {
  return args.homeEvents.map((event) => ({
    id: `home_events:${event.id}:${event.startsAt.toISOString()}`,
    eventType: 'home_event',
    source: 'home_events',
    severity: severityForHomeEvent({ title: event.title, description: event.description }),
    timestamp: event.startsAt.toISOString(),
    title: event.title,
    description: compactText(event.description) || 'Home event recorded.',
    linkage: {
      ...toScopeLinkage(args.scope.target),
      homeId: event.homeId ?? args.scope.target.homeId,
      homeName: event.home?.name ?? args.scope.target.homeName,
    },
    evidenceRef: {
      source: 'home_events',
      entityType: 'home_event',
      entityId: event.id,
      taskId: null,
      route: `/homes/${event.homeId}#event-${event.id}`,
    },
  }));
}

function mapAuditEvents(args: {
  audits: ChronologyAuditRow[];
  scope: ScopeDescriptor;
}): ChronologyEvent[] {
  return args.audits.map((audit) => {
    const actorName = audit.user ? toDisplayName(audit.user) : null;
    return {
      id: `audit_logs:${audit.id}:${audit.createdAt.toISOString()}`,
      eventType: 'audit',
      source: 'audit_logs',
      severity: severityForAudit(audit.action),
      timestamp: audit.createdAt.toISOString(),
      title: `Audit ${audit.action.replace(/_/g, ' ')}`,
      description: [
        actorName ? `Actor: ${actorName}.` : null,
        audit.entityType ? `Entity: ${audit.entityType}.` : null,
        audit.entityId ? `Reference: ${audit.entityId}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      linkage: toScopeLinkage(args.scope.target),
      evidenceRef: {
        source: 'audit_logs',
        entityType: 'audit_log',
        entityId: audit.id,
        taskId: null,
        route: `/audit?auditId=${audit.id}`,
      },
    };
  });
}

function applyChronologyConfidentiality(args: {
  targetType: ChronologyTargetType;
  target: ChronologyTarget;
  chronology: ChronologyEvent[];
  narrative: ChronologyNarrative | null;
  scope: ConfidentialityScope;
}): {
  target: ChronologyTarget;
  chronology: ChronologyEvent[];
  narrative: ChronologyNarrative | null;
} {
  if (args.scope === 'restricted') {
    return {
      target: args.target,
      chronology: args.chronology,
      narrative: args.narrative,
    };
  }

  const redactedTarget: ChronologyTarget = {
    ...args.target,
    name:
      args.targetType === 'young_person'
        ? (redactPersonName(args.target.name, 'standard') ?? 'Redacted person')
        : redactSensitiveText(args.target.name),
  };

  const redactedChronology = args.chronology.map((event) => ({
    ...event,
    description: redactSensitiveText(event.description),
    linkage: {
      ...event.linkage,
      youngPersonName: redactPersonName(event.linkage.youngPersonName, 'standard'),
    },
    evidenceRef: {
      ...event.evidenceRef,
      entityId: maskIdentifier(event.evidenceRef.entityId) ?? '[redacted-id]',
      taskId: maskIdentifier(event.evidenceRef.taskId),
    },
  }));

  const redactedNarrative: ChronologyNarrative | null = args.narrative
    ? {
        ...args.narrative,
        summary: redactSensitiveText(args.narrative.summary),
        keySignals: args.narrative.keySignals.map((signal) => redactSensitiveText(signal)),
        recommendedActions: args.narrative.recommendedActions.map((item) => redactSensitiveText(item)),
        evidenceReferences: args.narrative.evidenceReferences.map((value) => maskIdentifier(value) ?? '[redacted-id]'),
      }
    : null;

  return {
    target: redactedTarget,
    chronology: redactedChronology,
    narrative: redactedNarrative,
  };
}

async function resolveYoungPersonScope(args: {
  tenantId: string;
  youngPersonId: string;
}): Promise<ScopeDescriptor> {
  const youngPerson = await prisma.youngPerson.findFirst({
    where: {
      id: args.youngPersonId,
      tenantId: args.tenantId,
      isActive: true,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      homeId: true,
      home: { select: { id: true, name: true } },
    },
  });

  if (!youngPerson) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  return {
    targetType: 'young_person',
    target: {
      id: youngPerson.id,
      name: toDisplayName(youngPerson) ?? 'Young Person',
      homeId: youngPerson.home?.id ?? youngPerson.homeId,
      homeName: youngPerson.home?.name ?? null,
    },
    taskScopeWhere: {
      OR: [
        { youngPersonId: youngPerson.id },
        { homeId: youngPerson.homeId },
      ],
    },
    homeIdForEvents: youngPerson.homeId,
    auditEntityIds: [youngPerson.id, youngPerson.homeId],
  };
}

async function resolveHomeScope(args: {
  tenantId: string;
  homeId: string;
}): Promise<ScopeDescriptor> {
  const home = await prisma.home.findFirst({
    where: {
      id: args.homeId,
      tenantId: args.tenantId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  return {
    targetType: 'home',
    target: {
      id: home.id,
      name: home.name,
      homeId: home.id,
      homeName: home.name,
    },
    taskScopeWhere: {
      OR: [
        { homeId: home.id },
        { youngPerson: { homeId: home.id } },
      ],
    },
    homeIdForEvents: home.id,
    auditEntityIds: [home.id],
  };
}

async function buildChronology(args: {
  tenantId: string;
  scope: ScopeDescriptor;
  query: ChronologyQuery;
  confidentiality: ResolvedConfidentiality;
}): Promise<ChronologyResponse> {
  const { from, to, policyDays } = resolveWindow(args.query);
  const fetchLimit = Math.min(Math.max(args.query.maxEvents * 4, 200), 2000);

  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        {
          tenantId: args.tenantId,
          deletedAt: null,
          createdAt: { gte: from, lte: to },
        },
        args.scope.taskScopeWhere,
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      status: true,
      approvalStatus: true,
      priority: true,
      dueDate: true,
      approvedAt: true,
      submittedAt: true,
      createdAt: true,
      updatedAt: true,
      home: { select: { id: true, name: true } },
      youngPerson: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: fetchLimit,
  });

  const taskIds = tasks.map((task) => task.id);
  const auditEntityCandidates = [...new Set([...args.scope.auditEntityIds, ...taskIds])];

  const [homeEvents, audits] = await Promise.all([
    prisma.homeEvent.findMany({
      where: {
        tenantId: args.tenantId,
        homeId: args.scope.homeIdForEvents,
        startsAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        homeId: true,
        home: { select: { id: true, name: true } },
      },
      orderBy: { startsAt: 'desc' },
      take: fetchLimit,
    }),
    prisma.auditLog.findMany({
      where: {
        tenantId: args.tenantId,
        createdAt: { gte: from, lte: to },
        action: {
          in: [
            AuditAction.record_created,
            AuditAction.record_updated,
            AuditAction.record_deleted,
            AuditAction.record_accessed,
            AuditAction.permission_changed,
          ],
        },
        ...(auditEntityCandidates.length
          ? {
              OR: [
                { entityId: { in: auditEntityCandidates } },
                { entityType: 'home', entityId: args.scope.homeIdForEvents },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
    }),
  ]);

  const allEvents = [
    ...mapTaskEvents({ tasks, scope: args.scope }),
    ...mapHomeEventEvents({ homeEvents, scope: args.scope }),
    ...mapAuditEvents({ audits, scope: args.scope }),
  ];

  const deduped = dedupeChronology(allEvents);
  const sorted = sortChronology(deduped);
  const filtered = sorted.filter((event) => {
    if (args.query.eventType && event.eventType !== args.query.eventType) return false;
    if (args.query.severity && event.severity !== args.query.severity) return false;
    if (args.query.source && event.source !== args.query.source) return false;
    const ts = new Date(event.timestamp).getTime();
    if (ts < from.getTime() || ts > to.getTime()) return false;
    return true;
  });
  const chronology = filtered.slice(-args.query.maxEvents);

  const summary = {
    totalEvents: chronology.length,
    byType: countBy(chronology.map((event) => event.eventType)),
    bySeverity: countBy(chronology.map((event) => event.severity)),
    bySource: countBy(chronology.map((event) => event.source)),
    earliestAt: chronology[0]?.timestamp ?? null,
    latestAt: chronology[chronology.length - 1]?.timestamp ?? null,
  };

  const narrative = await buildNarrative({
    includeNarrative: args.query.includeNarrative,
    targetType: args.scope.targetType,
    targetName: args.scope.target.name,
    chronology,
  });

  const scopedPayload = applyChronologyConfidentiality({
    targetType: args.scope.targetType,
    target: args.scope.target,
    chronology,
    narrative,
    scope: args.confidentiality.effectiveScope,
  });

  return {
    targetType: args.scope.targetType,
    target: scopedPayload.target,
    window: {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      timezone: 'UTC',
    },
    retention: {
      policyDays,
      effectiveDateFrom: from.toISOString(),
      effectiveDateTo: to.toISOString(),
    },
    confidentiality: args.confidentiality,
    filtersApplied: {
      eventType: args.query.eventType ?? null,
      severity: args.query.severity ?? null,
      source: args.query.source ?? null,
      confidentialityScope: args.confidentiality.effectiveScope,
      maxEvents: args.query.maxEvents,
    },
    summary,
    chronology: scopedPayload.chronology,
    narrative: scopedPayload.narrative,
  };
}

export async function getYoungPersonChronology(
  actorUserId: string,
  youngPersonId: string,
  query: ChronologyQuery,
): Promise<ChronologyResponse> {
  const tenant = await requireTenantContext(actorUserId);
  const confidentiality = resolveConfidentialityScope({
    requestedScope: query.confidentialityScope,
    userRole: tenant.userRole,
    tenantRole: tenant.tenantRole,
  });
  const scope = await resolveYoungPersonScope({
    tenantId: tenant.tenantId,
    youngPersonId,
  });
  return buildChronology({ tenantId: tenant.tenantId, scope, query, confidentiality });
}

export async function getHomeChronology(
  actorUserId: string,
  homeId: string,
  query: ChronologyQuery,
): Promise<ChronologyResponse> {
  const tenant = await requireTenantContext(actorUserId);
  const confidentiality = resolveConfidentialityScope({
    requestedScope: query.confidentialityScope,
    userRole: tenant.userRole,
    tenantRole: tenant.tenantRole,
  });
  const scope = await resolveHomeScope({
    tenantId: tenant.tenantId,
    homeId,
  });
  return buildChronology({ tenantId: tenant.tenantId, scope, query, confidentiality });
}

type ReflectivePromptCategory =
  | 'mandatory'
  | 'incident_type'
  | 'child_profile'
  | 'safeguarding_class'
  | 'general';

type ReflectivePromptDefinition = {
  id: string;
  text: string;
  category: ReflectivePromptCategory;
  mandatory: boolean;
  order: number;
  version: string;
  tags: string[];
};

type ReflectivePromptSetContext = {
  taskId: string | null;
  formTemplateKey: string | null;
  formGroup: string | null;
  contextCategory: ReflectivePromptContextCategory;
  incidentType: ReflectivePromptIncidentType;
  childProfile: ReflectivePromptChildProfile;
  safeguardingClass: ReflectivePromptSafeguardingClass;
};

type ReflectivePromptSet = {
  key: string;
  version: string;
  rollout: {
    enabled: boolean;
    mode: 'all' | 'incident_only' | 'daily_log_only' | 'off';
    reason: string | null;
  };
  context: ReflectivePromptSetContext;
  prompts: ReflectivePromptDefinition[];
  mandatoryPromptIds: string[];
  guidance: string[];
  generatedAt: string;
};

type ReflectivePromptResponse = {
  promptId: string;
  response: string;
  answeredAt: string | null;
};

type ReflectivePromptResponseEntry = {
  promptId: string;
  promptText: string;
  response: string;
  category: ReflectivePromptCategory;
  mandatory: boolean;
  answeredAt: string;
};

type ReflectivePromptSetResponse = {
  promptSet: ReflectivePromptSet;
  existingResponses: ReflectivePromptResponse[];
};

type ReflectivePromptSaveResult = {
  taskId: string;
  savedAt: string;
  reflectivePrompts: {
    version: string;
    promptSetKey: string;
    source: 'manual' | 'ai_assist' | 'imported';
    context: ReflectivePromptSetContext;
    responses: ReflectivePromptResponseEntry[];
    mandatoryPromptIds: string[];
    mandatoryAnsweredCount: number;
    totalResponses: number;
  };
};

type ReflectiveActorContext = {
  userId: string;
  tenantId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
  employeeId: string | null;
};

type ReflectiveTaskContext = {
  id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  formTemplateKey: string | null;
  formGroup: string | null;
  createdById: string | null;
  assigneeId: string | null;
  submissionPayload: Prisma.JsonValue | null;
};

type ReflectiveRolloutConfig = {
  enabled: boolean;
  mode: 'all' | 'incident_only' | 'daily_log_only' | 'off';
  defaultVersion: string;
  allowWrite: boolean;
};

type ReflectivePromptCatalogVersion = {
  mandatory: Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[];
  byIncidentType: Partial<
    Record<ReflectivePromptIncidentType, Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[]>
  >;
  byChildProfile: Partial<
    Record<ReflectivePromptChildProfile, Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[]>
  >;
  bySafeguardingClass: Partial<
    Record<ReflectivePromptSafeguardingClass, Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[]>
  >;
  general: Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[];
  guidance: string[];
};

const DEFAULT_REFLECTIVE_PROMPT_VERSION = 'v1';
const REFLECTIVE_SECTION_ID = 'reflective_prompts';
const REFLECTIVE_SECTION_TYPE = 'therapeutic_reflection';
const REFLECTIVE_SECTION_LABEL = 'Reflective Recording Prompts';

const REFLECTIVE_PROMPT_LIBRARY: Record<string, ReflectivePromptCatalogVersion> = {
  v1: {
    mandatory: [
      { id: 'communication_signal', text: 'What might the child have been communicating?' },
      { id: 'underlying_emotion', text: 'What emotion may have been underneath the behaviour?' },
      { id: 'regulation_support', text: 'What helped regulate the situation?' },
    ],
    byIncidentType: {
      medication: [
        { id: 'medication_context', text: 'What was happening immediately before medication was offered?' },
        { id: 'medication_safety_next', text: 'What immediate safety checks are needed before the next medication round?' },
      ],
      missing_from_home: [
        { id: 'mfh_trigger_pattern', text: 'What early signs suggested the child may leave placement today?' },
        { id: 'mfh_return_support', text: 'What support approach is most likely to help the child re-engage after return?' },
      ],
      physical_intervention: [
        { id: 'pi_deescalation_before', text: 'Which de-escalation attempts were used before physical intervention?' },
        { id: 'pi_repair_relationship', text: 'How will the team repair trust with the child after this event?' },
      ],
      self_harm: [
        { id: 'selfharm_meaning', text: 'What distress signal might this behaviour be expressing right now?' },
        { id: 'selfharm_protection', text: 'What protective action is required in the next 24 hours?' },
      ],
      online_safety: [
        { id: 'online_trigger', text: 'What online interaction appears to have increased risk in this situation?' },
        { id: 'online_support_plan', text: 'What boundaries and support can keep the child connected but safer online?' },
      ],
      behaviour: [
        { id: 'behaviour_pattern', text: 'What pattern in environment, routine, or relationships may have contributed?' },
      ],
      general_incident: [
        { id: 'incident_learning', text: 'What should staff do differently next time to reduce escalation risk?' },
      ],
    },
    byChildProfile: {
      trauma_informed: [
        { id: 'trauma_trigger', text: 'Could any part of this event have felt unsafe or re-triggering for the child?' },
      ],
      neurodivergent_support: [
        { id: 'neurodivergent_adjustment', text: 'What communication or sensory adjustment might have supported regulation sooner?' },
      ],
      placement_transition: [
        { id: 'transition_stability', text: 'How might placement uncertainty have influenced the child’s response today?' },
      ],
    },
    bySafeguardingClass: {
      missing_from_home: [
        { id: 'class_mfh_safety_plan', text: 'What should be updated in the return-home safety plan now?' },
      ],
      medication_safety: [
        { id: 'class_medication_followup', text: 'What medication follow-up evidence must be logged for accountability?' },
      ],
      physical_safety: [
        { id: 'class_physical_safety_change', text: 'What immediate environmental or staffing adjustment will reduce repeat risk?' },
      ],
      emotional_wellbeing: [
        { id: 'class_emotional_support', text: 'What emotional support does the child need from key adults in the next shift?' },
      ],
      behaviour_regulation: [
        { id: 'class_regulation_strategy', text: 'Which regulation strategy was most effective and should be repeated?' },
      ],
      online_safety: [
        { id: 'class_online_boundary', text: 'What specific online boundary and check-in rhythm should be agreed with the child?' },
      ],
      safeguarding_general: [
        { id: 'class_general_safeguarding', text: 'What safeguarding concern should be monitored most closely over the next 72 hours?' },
      ],
    },
    general: [
      { id: 'staff_reflection', text: 'What did the team do well in this situation that should be repeated?' },
      { id: 'next_best_action', text: 'What is the single most important next action for therapeutic progress?' },
    ],
    guidance: [
      'Use non-blaming, child-centred language.',
      'Keep answers concise and evidence-linked.',
      'Capture immediate safety actions and follow-up owner.',
    ],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseBool(raw: string | undefined, fallback: boolean) {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

function parseRolloutMode(raw: string | undefined): ReflectiveRolloutConfig['mode'] {
  if (raw === 'incident_only' || raw === 'daily_log_only' || raw === 'off') return raw;
  return 'all';
}

function reflectiveRolloutConfig(): ReflectiveRolloutConfig {
  return {
    enabled: parseBool(process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_ENABLED, true),
    mode: parseRolloutMode(process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_ROLLOUT_MODE),
    defaultVersion: (process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_VERSION ?? DEFAULT_REFLECTIVE_PROMPT_VERSION).trim() || DEFAULT_REFLECTIVE_PROMPT_VERSION,
    allowWrite: parseBool(process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_WRITE_ENABLED, true),
  };
}

async function resolveReflectiveActor(userId: string): Promise<ReflectiveActorContext> {
  const tenant = await requireTenantContext(userId);
  const [user, employee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    }),
    prisma.employee.findFirst({
      where: {
        tenantId: tenant.tenantId,
        userId,
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  return {
    userId,
    tenantId: tenant.tenantId,
    userRole: user.role,
    tenantRole: tenant.tenantRole,
    employeeId: employee?.id ?? null,
  };
}

function isPrivilegedReflectiveActor(actor: ReflectiveActorContext) {
  if (actor.userRole === UserRole.super_admin) return true;
  if (actor.userRole === UserRole.admin || actor.userRole === UserRole.manager) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function canAccessReflectiveTask(actor: ReflectiveActorContext, task: Pick<ReflectiveTaskContext, 'createdById' | 'assigneeId'>) {
  if (isPrivilegedReflectiveActor(actor)) return true;
  if (task.createdById === actor.userId) return true;
  return Boolean(actor.employeeId && task.assigneeId === actor.employeeId);
}

function inferIncidentType(text: string): ReflectivePromptIncidentType {
  if (text.includes('medication') || text.includes('prn')) return 'medication';
  if (text.includes('missing') || text.includes('abscond')) return 'missing_from_home';
  if (text.includes('restraint') || text.includes('physical intervention')) return 'physical_intervention';
  if (text.includes('self-harm') || text.includes('self harm')) return 'self_harm';
  if (text.includes('online') || text.includes('social media') || text.includes('internet')) return 'online_safety';
  if (text.includes('behaviour') || text.includes('aggression') || text.includes('escalation')) return 'behaviour';
  return 'general_incident';
}

function inferSafeguardingClass(text: string): ReflectivePromptSafeguardingClass {
  if (text.includes('missing') || text.includes('abscond')) return 'missing_from_home';
  if (text.includes('medication') || text.includes('prn')) return 'medication_safety';
  if (text.includes('online') || text.includes('social media')) return 'online_safety';
  if (text.includes('self-harm') || text.includes('self harm') || text.includes('emotional')) return 'emotional_wellbeing';
  if (text.includes('injury') || text.includes('restraint') || text.includes('physical')) return 'physical_safety';
  if (text.includes('behaviour') || text.includes('regulation')) return 'behaviour_regulation';
  return 'safeguarding_general';
}

function mergeReflectiveContext(args: {
  task: ReflectiveTaskContext | null;
  query: {
    taskId?: string | undefined;
    formTemplateKey?: string | undefined;
    formGroup?: string | undefined;
    contextCategory?: ReflectivePromptContextCategory | undefined;
    incidentType?: ReflectivePromptIncidentType | undefined;
    childProfile?: ReflectivePromptChildProfile | undefined;
    safeguardingClass?: ReflectivePromptSafeguardingClass | undefined;
  };
}): ReflectivePromptSetContext {
  const taskText = `${args.task?.title ?? ''} ${args.task?.description ?? ''} ${args.task?.formGroup ?? ''} ${args.task?.formTemplateKey ?? ''}`.toLowerCase();
  const inferredCategory: ReflectivePromptContextCategory =
    args.task?.category === TaskCategory.incident
      ? 'incident'
      : args.task?.category === TaskCategory.daily_log
        ? 'daily_log'
        : taskText.includes('incident')
          ? 'incident'
          : taskText.includes('daily')
            ? 'daily_log'
            : 'general';

  return {
    taskId: args.query.taskId ?? args.task?.id ?? null,
    formTemplateKey: args.query.formTemplateKey ?? args.task?.formTemplateKey ?? null,
    formGroup: args.query.formGroup ?? args.task?.formGroup ?? null,
    contextCategory: args.query.contextCategory ?? inferredCategory,
    incidentType: args.query.incidentType ?? inferIncidentType(taskText),
    childProfile: args.query.childProfile ?? 'standard',
    safeguardingClass: args.query.safeguardingClass ?? inferSafeguardingClass(taskText),
  };
}

function buildPromptSet(args: {
  context: ReflectivePromptSetContext;
  version: string;
  includeOptional: boolean;
  rollout: ReflectiveRolloutConfig;
}): ReflectivePromptSet {
  const selectedVersion = REFLECTIVE_PROMPT_LIBRARY[args.version] ? args.version : DEFAULT_REFLECTIVE_PROMPT_VERSION;
  const versionData = REFLECTIVE_PROMPT_LIBRARY[selectedVersion];
  const key = `reflective:${args.context.contextCategory}:${args.context.incidentType}:${args.context.safeguardingClass}`;

  const rolloutBlocked =
    !args.rollout.enabled ||
    args.rollout.mode === 'off' ||
    (args.rollout.mode === 'incident_only' && args.context.contextCategory !== 'incident') ||
    (args.rollout.mode === 'daily_log_only' && args.context.contextCategory !== 'daily_log');

  if (rolloutBlocked) {
    return {
      key,
      version: selectedVersion,
      rollout: {
        enabled: false,
        mode: args.rollout.mode,
        reason: 'Reflective prompt rollout is disabled for this context.',
      },
      context: args.context,
      prompts: [],
      mandatoryPromptIds: [],
      guidance: versionData.guidance,
      generatedAt: new Date().toISOString(),
    };
  }

  let order = 1;
  const addPrompts = (
    items: Omit<ReflectivePromptDefinition, 'category' | 'mandatory' | 'order' | 'version' | 'tags'>[],
    category: ReflectivePromptCategory,
    mandatory: boolean,
    tags: string[],
  ) => {
    return items.map((item) => ({
      id: item.id,
      text: item.text,
      category,
      mandatory,
      order: order++,
      version: selectedVersion,
      tags,
    }));
  };

  const mandatoryPrompts = addPrompts(
    versionData.mandatory,
    'mandatory',
    true,
    ['mandatory', 'non_blaming'],
  );

  const optionalPrompts = args.includeOptional
    ? [
        ...addPrompts(
          versionData.byIncidentType[args.context.incidentType] ?? [],
          'incident_type',
          false,
          [args.context.incidentType],
        ),
        ...addPrompts(
          versionData.byChildProfile[args.context.childProfile] ?? [],
          'child_profile',
          false,
          [args.context.childProfile],
        ),
        ...addPrompts(
          versionData.bySafeguardingClass[args.context.safeguardingClass] ?? [],
          'safeguarding_class',
          false,
          [args.context.safeguardingClass],
        ),
        ...addPrompts(versionData.general, 'general', false, ['general']),
      ]
    : [];

  const deduped = [...mandatoryPrompts, ...optionalPrompts].filter((prompt, index, arr) =>
    arr.findIndex((candidate) => candidate.id === prompt.id) === index,
  );

  return {
    key,
    version: selectedVersion,
    rollout: {
      enabled: true,
      mode: args.rollout.mode,
      reason: null,
    },
    context: args.context,
    prompts: deduped,
    mandatoryPromptIds: mandatoryPrompts.map((prompt) => prompt.id),
    guidance: versionData.guidance,
    generatedAt: new Date().toISOString(),
  };
}

function readExistingReflectiveResponses(payload: Prisma.JsonValue | null): ReflectivePromptResponse[] {
  const payloadObj = isRecord(payload) ? payload : null;
  if (!payloadObj) return [];
  const reflective = isRecord(payloadObj.reflectivePrompts) ? payloadObj.reflectivePrompts : null;
  if (!reflective) return [];
  const responsesRaw = Array.isArray(reflective.responses) ? (reflective.responses as unknown[]) : [];
  return responsesRaw
    .filter(isRecord)
    .map((item) => ({
      promptId: typeof item.promptId === 'string' ? item.promptId : '',
      response: typeof item.response === 'string' ? item.response : '',
      answeredAt: asStringOrNull(item.answeredAt),
    }))
    .filter((item) => item.promptId && item.response);
}

async function fetchReflectiveTaskContext(args: {
  tenantId: string;
  taskId: string;
}): Promise<ReflectiveTaskContext> {
  const task = await prisma.task.findFirst({
    where: { id: args.taskId, tenantId: args.tenantId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      formTemplateKey: true,
      formGroup: true,
      createdById: true,
      assigneeId: true,
      submissionPayload: true,
    },
  });

  if (!task) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }
  return task;
}

export async function getReflectivePromptSet(
  actorUserId: string,
  query: ReflectivePromptQuery,
): Promise<ReflectivePromptSetResponse> {
  const actor = await resolveReflectiveActor(actorUserId);
  const rollout = reflectiveRolloutConfig();
  const task =
    query.taskId
      ? await fetchReflectiveTaskContext({ tenantId: actor.tenantId, taskId: query.taskId })
      : null;

  if (task && !canAccessReflectiveTask(actor, task)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const context = mergeReflectiveContext({
    task,
    query,
  });

  const promptSet = buildPromptSet({
    context,
    version: query.version ?? rollout.defaultVersion,
    includeOptional: query.includeOptional,
    rollout,
  });
  const existingResponses = task ? readExistingReflectiveResponses(task.submissionPayload) : [];

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_accessed,
      entityType: 'reflective_prompt_set',
      entityId: task?.id ?? null,
      metadata: {
        taskId: task?.id ?? null,
        version: promptSet.version,
        rollout: promptSet.rollout,
        context,
        promptCount: promptSet.prompts.length,
      },
    },
  });

  return {
    promptSet,
    existingResponses,
  };
}

export async function saveReflectivePromptResponses(
  actorUserId: string,
  taskId: string,
  body: SaveReflectivePromptResponsesBody,
): Promise<ReflectivePromptSaveResult> {
  const actor = await resolveReflectiveActor(actorUserId);
  const rollout = reflectiveRolloutConfig();
  if (!rollout.allowWrite) {
    throw httpError(
      403,
      'REFLECTIVE_PROMPT_WRITE_DISABLED',
      'Reflective prompt response capture is currently disabled.',
    );
  }

  const task = await fetchReflectiveTaskContext({
    tenantId: actor.tenantId,
    taskId,
  });
  if (!canAccessReflectiveTask(actor, task)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const context = mergeReflectiveContext({
    task,
    query: {
      taskId,
      formTemplateKey: body.formTemplateKey,
      formGroup: body.formGroup,
      contextCategory: body.contextCategory,
      incidentType: body.incidentType,
      childProfile: body.childProfile,
      safeguardingClass: body.safeguardingClass,
    },
  });

  const promptSet = buildPromptSet({
    context,
    version: body.version ?? rollout.defaultVersion,
    includeOptional: true,
    rollout,
  });
  if (!promptSet.rollout.enabled) {
    throw httpError(
      403,
      'REFLECTIVE_PROMPTS_DISABLED_FOR_CONTEXT',
      'Reflective prompt rollout is disabled for this context.',
    );
  }

  const promptMap = new Map(promptSet.prompts.map((prompt) => [prompt.id, prompt]));
  const seenPromptIds = new Set<string>();
  const savedAt = new Date().toISOString();
  const responses: ReflectivePromptResponseEntry[] = body.responses.map((entry) => {
    if (seenPromptIds.has(entry.promptId)) {
      throw httpError(422, 'DUPLICATE_PROMPT_RESPONSE', `Duplicate response for prompt '${entry.promptId}'.`);
    }
    seenPromptIds.add(entry.promptId);
    const prompt = promptMap.get(entry.promptId);
    if (!prompt) {
      throw httpError(422, 'UNKNOWN_PROMPT_ID', `Prompt '${entry.promptId}' is not part of this prompt set.`);
    }
    return {
      promptId: prompt.id,
      promptText: prompt.text,
      response: entry.response.trim(),
      category: prompt.category,
      mandatory: prompt.mandatory,
      answeredAt: savedAt,
    };
  });

  const answeredMandatoryIds = new Set(
    responses.filter((entry) => entry.mandatory).map((entry) => entry.promptId),
  );
  const mandatoryMissing = promptSet.mandatoryPromptIds.filter((id) => !answeredMandatoryIds.has(id));
  if (mandatoryMissing.length > 0) {
    throw httpError(
      422,
      'MANDATORY_PROMPTS_INCOMPLETE',
      'All mandatory reflective prompts must be answered before saving.',
    );
  }

  const payloadObj = isRecord(task.submissionPayload) ? { ...task.submissionPayload } : {};
  const existingSectionsRaw = Array.isArray(payloadObj.sections) ? (payloadObj.sections as unknown[]) : [];
  const existingSections = existingSectionsRaw.filter(isRecord);

  const reflectivePromptsPayload = {
    version: promptSet.version,
    promptSetKey: promptSet.key,
    source: body.source,
    context: promptSet.context,
    responses,
    mandatoryPromptIds: promptSet.mandatoryPromptIds,
    mandatoryAnsweredCount: answeredMandatoryIds.size,
    totalResponses: responses.length,
    savedAt,
    savedByUserId: actor.userId,
  } satisfies ReflectivePromptSaveResult['reflectivePrompts'] & { savedByUserId: string; savedAt: string };

  const reflectiveSection = {
    id: REFLECTIVE_SECTION_ID,
    type: REFLECTIVE_SECTION_TYPE,
    label: REFLECTIVE_SECTION_LABEL,
    version: promptSet.version,
    context: promptSet.context,
    mandatoryPromptIds: promptSet.mandatoryPromptIds,
    entries: responses,
    completion: {
      mandatoryAnsweredCount: answeredMandatoryIds.size,
      mandatoryTotal: promptSet.mandatoryPromptIds.length,
    },
    savedAt,
    savedByUserId: actor.userId,
  };

  const mergedSections = [
    ...existingSections.filter((section) => asStringOrNull(section.id) !== REFLECTIVE_SECTION_ID),
    reflectiveSection,
  ];

  const nextPayload = {
    ...payloadObj,
    reflectivePrompts: reflectivePromptsPayload,
    sections: mergedSections,
  } as Prisma.InputJsonValue;

  await prisma.task.update({
    where: { id: task.id },
    data: {
      submissionPayload: nextPayload,
      updatedById: actor.userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'task_reflective_prompts',
      entityId: task.id,
      metadata: {
        promptSetKey: promptSet.key,
        version: promptSet.version,
        source: body.source,
        mandatoryAnsweredCount: answeredMandatoryIds.size,
        mandatoryTotal: promptSet.mandatoryPromptIds.length,
        totalResponses: responses.length,
      },
    },
  });

  return {
    taskId: task.id,
    savedAt,
    reflectivePrompts: {
      version: promptSet.version,
      promptSetKey: promptSet.key,
      source: body.source,
      context: promptSet.context,
      responses,
      mandatoryPromptIds: promptSet.mandatoryPromptIds,
      mandatoryAnsweredCount: answeredMandatoryIds.size,
      totalResponses: responses.length,
    },
  };
}
