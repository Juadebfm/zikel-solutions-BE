import {
  Prisma,
  TaskApprovalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
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
import type { IncidentPatternQuery } from './patterns.schema.js';

const DEFAULT_LOOKBACK_DAYS = 90;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'from', 'this', 'were', 'was', 'into', 'onto', 'about', 'after', 'before',
  'during', 'there', 'their', 'them', 'they', 'have', 'has', 'had', 'been', 'being', 'would', 'could', 'should',
  'into', 'where', 'which', 'when', 'while', 'task', 'incident', 'report', 'log', 'entry', 'home', 'young', 'person',
  'staff', 'team', 'note', 'notes', 'details', 'detail',
]);

const GENERIC_TAGS = new Set([
  'update', 'general', 'recorded', 'reported', 'issue', 'concern', 'support', 'care', 'child', 'behaviour',
]);

const TRIGGER_KEY_HINTS = [
  'trigger',
  'antecedent',
  'cause',
  'reason',
  'behaviourtrigger',
  'incidenttrigger',
];
const OUTCOME_KEY_HINTS = [
  'outcome',
  'actiontaken',
  'actions',
  'result',
  'response',
  'followup',
  'deescalation',
];
const ROLE_KEY_HINTS = [
  'involvedrole',
  'staffinvolved',
  'roles',
  'witness',
  'participants',
  'presentstaff',
];
const LOCATION_KEY_HINTS = ['location', 'incidentlocation', 'area', 'room', 'place', 'unit', 'zone'];
const TIME_KEY_HINTS = ['occurredat', 'incidenttime', 'incidentdate', 'eventtime', 'eventdate', 'timestamp'];

const KNOWN_TRIGGER_TERMS: Array<{ tag: string; terms: string[] }> = [
  { tag: 'missing', terms: ['missing', 'abscond', 'unauthorised absence'] },
  { tag: 'self-harm', terms: ['self harm', 'self-harm', 'self injury'] },
  { tag: 'aggression', terms: ['aggression', 'aggressive', 'assault', 'violence', 'fight'] },
  { tag: 'medication-refusal', terms: ['medication refusal', 'refused medication', 'med refusal'] },
  { tag: 'restraint', terms: ['restraint', 'physical intervention', 'hold'] },
  { tag: 'police', terms: ['police', 'officer'] },
  { tag: 'injury', terms: ['injury', 'injured', 'wound', 'bruise'] },
  { tag: 'safeguarding', terms: ['safeguard', 'safeguarding'] },
  { tag: 'property-damage', terms: ['property damage', 'damaged', 'vandal'] },
  { tag: 'dysregulation', terms: ['dysregulation', 'meltdown', 'escalation'] },
];

const CRITICAL_SEVERITY_TERMS = [
  'police',
  'hospital',
  'missing',
  'restraint',
  'assault',
  'self-harm',
  'self harm',
  'emergency',
];
const HIGH_SEVERITY_TERMS = ['injury', 'aggression', 'violent', 'threat', 'safeguard'];

const ACTIVE_TASK_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function patternRetentionDays(): number {
  return parsePositiveInt(process.env.SAFEGUARDING_PATTERNS_RETENTION_DAYS, 365, 30);
}

function defaultConfidentialityScope(): ConfidentialityScope {
  return process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE === 'restricted'
    ? 'restricted'
    : 'standard';
}

type PatternTargetType = 'young_person' | 'home';
type PatternType = 'frequency' | 'cluster' | 'recurrence' | 'co_occurrence';
type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

type PatternTarget = {
  id: string;
  name: string;
  homeId: string | null;
  homeName: string | null;
};

type PatternScopeDescriptor = {
  targetType: PatternTargetType;
  target: PatternTarget;
  incidentTaskWhere: Prisma.TaskWhereInput;
};

type IncidentTaskRow = Prisma.TaskGetPayload<{
  select: {
    id: true;
    title: true;
    description: true;
    priority: true;
    status: true;
    approvalStatus: true;
    dueDate: true;
    createdAt: true;
    updatedAt: true;
    submittedAt: true;
    submissionPayload: true;
    homeId: true;
    youngPersonId: true;
    home: { select: { id: true; name: true } };
    youngPerson: { select: { id: true; firstName: true; lastName: true } };
    assignee: { select: { jobTitle: true; role: { select: { name: true } } } };
  };
}>;

type NormalizedIncidentFeature = {
  incidentId: string;
  occurredAt: string;
  dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  hourOfDay: number;
  location: {
    homeId: string | null;
    homeName: string | null;
    area: string | null;
  };
  triggerTags: string[];
  involvedRoles: string[];
  outcomes: string[];
  severity: IncidentSeverity;
  evidenceRef: {
    source: 'tasks';
    entityType: 'task';
    entityId: string;
    route: string;
  };
};

type PatternSignal = {
  id: string;
  patternType: PatternType;
  label: string;
  metricCount: number;
  confidence: number;
  whyFlagged: string;
  evidenceReferences: string[];
  relatedTags: string[];
};

export type IncidentPatternsResponse = {
  targetType: PatternTargetType;
  target: PatternTarget;
  window: {
    dateFrom: string;
    dateTo: string;
    timezone: 'UTC';
  };
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
    confidentialityScope: ConfidentialityScope;
    maxIncidents: number;
    minOccurrences: number;
    confidenceThreshold: number;
    maxPatterns: number;
  };
  summary: {
    totalIncidents: number;
    flaggedPatterns: number;
    highConfidencePatterns: number;
    latestIncidentAt: string | null;
    uniqueTriggerTags: number;
  };
  normalizedIncidents: NormalizedIncidentFeature[];
  patterns: {
    frequency: PatternSignal[];
    clusters: PatternSignal[];
    recurrence: PatternSignal[];
    coOccurrence: PatternSignal[];
  };
  insights: {
    patternInsightSummaries: string[];
    exploreNext: Array<{
      label: string;
      reason: string;
      action: string;
    }>;
  };
};

type ResolvedConfidentiality = {
  requestedScope: ConfidentialityScope;
  effectiveScope: ConfidentialityScope;
};

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

function resolveWindow(query: IncidentPatternQuery): { from: Date; to: Date; policyDays: number } {
  const now = new Date();
  const policyDays = patternRetentionDays();
  const retentionFrom = new Date(now.getTime() - policyDays * 24 * 60 * 60 * 1_000);
  const fallbackFrom = new Date(now.getTime() - Math.min(DEFAULT_LOOKBACK_DAYS, policyDays) * 24 * 60 * 60 * 1_000);
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
  userRole: 'super_admin' | 'staff' | 'manager' | 'admin';
  tenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null;
}): ResolvedConfidentiality {
  const requestedScope = args.requestedScope ?? defaultConfidentialityScope();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cleanPhrase(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stringValues(input: unknown): string[] {
  if (typeof input === 'string') return [cleanPhrase(input)];
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === 'string') out.push(cleanPhrase(item));
  }
  return out.filter(Boolean);
}

function collectValuesByKeyHints(input: unknown, keyHints: string[], depth = 0): unknown[] {
  if (!isRecord(input) || depth > 4) return [];
  const output: unknown[] = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const normalized = normalizeKey(rawKey);
    if (keyHints.some((hint) => normalized.includes(hint))) {
      output.push(rawValue);
    }
    if (isRecord(rawValue) || Array.isArray(rawValue)) {
      output.push(...collectValuesByKeyHints(rawValue, keyHints, depth + 1));
    }
  }
  return output;
}

function collectText(input: unknown): string[] {
  if (typeof input === 'string') return [cleanPhrase(input)];
  if (Array.isArray(input)) {
    const out: string[] = [];
    for (const entry of input) out.push(...collectText(entry));
    return out;
  }
  if (!isRecord(input)) return [];
  const out: string[] = [];
  for (const value of Object.values(input)) out.push(...collectText(value));
  return out;
}

function parseDateCandidate(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input === 'number' && Number.isFinite(input)) {
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) return date;
    return null;
  }
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  const withTimezone = /\dT\d/.test(value) || /Z$|[+-]\d{2}:\d{2}$/.test(value);
  const parsed = new Date(withTimezone ? value : `${value}Z`);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

function inferOccurredAt(task: IncidentTaskRow): Date {
  const payload = isRecord(task.submissionPayload) ? task.submissionPayload : null;
  if (payload) {
    const values = collectValuesByKeyHints(payload, TIME_KEY_HINTS);
    for (const value of values) {
      const parsed = parseDateCandidate(value);
      if (parsed) return parsed;
    }
  }
  return task.submittedAt ?? task.createdAt;
}

function extractKeywordTags(text: string, max = 8): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([word]) => sanitizeTag(word))
    .filter((tag) => tag && !GENERIC_TAGS.has(tag))
    .slice(0, max);
}

function extractKnownTriggerTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const rule of KNOWN_TRIGGER_TERMS) {
    if (rule.terms.some((term) => lower.includes(term))) tags.push(rule.tag);
  }
  return tags;
}

function dedupeStrings(values: string[], max = 10): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const cleaned = cleanPhrase(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= max) break;
  }
  return output;
}

function extractTriggerTags(task: IncidentTaskRow): string[] {
  const payload = isRecord(task.submissionPayload) ? task.submissionPayload : null;
  const triggerTexts = payload ? collectValuesByKeyHints(payload, TRIGGER_KEY_HINTS).flatMap((value) => collectText(value)) : [];
  const sourceText = [task.title, task.description ?? '', ...triggerTexts].filter(Boolean).join(' ');
  const knownTags = extractKnownTriggerTags(sourceText);
  const keywordTags = extractKeywordTags(sourceText, 10);

  return dedupeStrings([
    ...knownTags,
    ...keywordTags,
  ].map((tag) => sanitizeTag(tag)).filter(Boolean), 10).filter((tag) => !GENERIC_TAGS.has(tag));
}

function extractRoles(task: IncidentTaskRow): string[] {
  const payload = isRecord(task.submissionPayload) ? task.submissionPayload : null;
  const payloadRoles = payload
    ? collectValuesByKeyHints(payload, ROLE_KEY_HINTS).flatMap((value) => stringValues(value).length > 0 ? stringValues(value) : collectText(value))
    : [];
  const inferred = [
    task.assignee?.jobTitle ?? '',
    task.assignee?.role?.name ?? '',
  ];
  return dedupeStrings([...payloadRoles, ...inferred], 6);
}

function extractOutcomes(task: IncidentTaskRow): string[] {
  const payload = isRecord(task.submissionPayload) ? task.submissionPayload : null;
  const payloadOutcomes = payload
    ? collectValuesByKeyHints(payload, OUTCOME_KEY_HINTS).flatMap((value) => stringValues(value).length > 0 ? stringValues(value) : collectText(value))
    : [];
  const fallback = task.description ? [task.description] : [];
  return dedupeStrings([...payloadOutcomes, ...fallback], 6);
}

function extractArea(task: IncidentTaskRow): string | null {
  const payload = isRecord(task.submissionPayload) ? task.submissionPayload : null;
  if (!payload) return null;
  const locationValues = collectValuesByKeyHints(payload, LOCATION_KEY_HINTS);
  for (const value of locationValues) {
    const options = stringValues(value).length > 0 ? stringValues(value) : collectText(value);
    const first = options.find((entry) => entry.length > 1);
    if (first) return first.slice(0, 120);
  }
  return null;
}

function severityRank(value: IncidentSeverity): number {
  switch (value) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low':
    default:
      return 1;
  }
}

function maxSeverity(left: IncidentSeverity, right: IncidentSeverity): IncidentSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function inferSeverity(task: IncidentTaskRow, triggerTags: string[]): IncidentSeverity {
  let severity: IncidentSeverity = 'medium';

  if (task.priority === TaskPriority.low) severity = 'low';
  if (task.priority === TaskPriority.medium) severity = maxSeverity(severity, 'medium');
  if (task.priority === TaskPriority.high) severity = maxSeverity(severity, 'high');
  if (task.priority === TaskPriority.urgent) severity = maxSeverity(severity, 'critical');

  if (task.approvalStatus === TaskApprovalStatus.rejected) {
    severity = maxSeverity(severity, 'high');
  }

  if (
    task.dueDate
    && ACTIVE_TASK_STATUSES.includes(task.status)
    && task.dueDate.getTime() < Date.now()
  ) {
    severity = maxSeverity(severity, 'high');
  }

  const text = `${task.title} ${task.description ?? ''} ${triggerTags.join(' ')}`.toLowerCase();
  if (CRITICAL_SEVERITY_TERMS.some((term) => text.includes(term))) severity = maxSeverity(severity, 'critical');
  if (HIGH_SEVERITY_TERMS.some((term) => text.includes(term))) severity = maxSeverity(severity, 'high');

  return severity;
}

function normalizeIncident(task: IncidentTaskRow): NormalizedIncidentFeature {
  const occurredAt = inferOccurredAt(task);
  const triggerTags = extractTriggerTags(task);
  const dayIndex = occurredAt.getUTCDay();
  const dayOfWeek = DAY_NAMES[dayIndex === 0 ? 0 : dayIndex] as NormalizedIncidentFeature['dayOfWeek'];

  return {
    incidentId: task.id,
    occurredAt: occurredAt.toISOString(),
    dayOfWeek,
    hourOfDay: occurredAt.getUTCHours(),
    location: {
      homeId: task.home?.id ?? task.homeId ?? null,
      homeName: task.home?.name ?? null,
      area: extractArea(task),
    },
    triggerTags,
    involvedRoles: extractRoles(task),
    outcomes: extractOutcomes(task),
    severity: inferSeverity(task, triggerTags),
    evidenceRef: {
      source: 'tasks',
      entityType: 'task',
      entityId: task.id,
      route: `/tasks/${task.id}`,
    },
  };
}

function takeEvidence(incidents: NormalizedIncidentFeature[], predicate: (incident: NormalizedIncidentFeature) => boolean) {
  return incidents.filter(predicate).map((incident) => incident.incidentId).slice(0, 12);
}

function createSignal(input: Omit<PatternSignal, 'confidence'> & { confidence: number }): PatternSignal {
  return {
    ...input,
    confidence: round2(clamp(input.confidence, 0, 0.99)),
  };
}

function sortSignals(signals: PatternSignal[]) {
  return [...signals].sort((a, b) => (b.confidence - a.confidence) || (b.metricCount - a.metricCount) || a.label.localeCompare(b.label));
}

function filterSignals(signals: PatternSignal[], confidenceThreshold: number, maxPatterns: number): PatternSignal[] {
  return sortSignals(signals)
    .filter((signal) => signal.confidence >= confidenceThreshold)
    .slice(0, maxPatterns);
}

function hourBlock(hour: number): 'overnight' | 'morning' | 'afternoon' | 'evening' {
  if (hour < 6) return 'overnight';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function buildFrequencySignals(incidents: NormalizedIncidentFeature[], minOccurrences: number): PatternSignal[] {
  if (incidents.length === 0) return [];
  const signals: PatternSignal[] = [];

  const byDay = new Map<string, number>();
  const byBlock = new Map<string, number>();

  for (const incident of incidents) {
    byDay.set(incident.dayOfWeek, (byDay.get(incident.dayOfWeek) ?? 0) + 1);
    const block = hourBlock(incident.hourOfDay);
    byBlock.set(block, (byBlock.get(block) ?? 0) + 1);
  }

  for (const [day, count] of byDay.entries()) {
    if (count < minOccurrences) continue;
    const support = count / incidents.length;
    const confidence = 0.35 + support + (count >= minOccurrences * 2 ? 0.12 : 0);
    signals.push(createSignal({
      id: `frequency:day:${day}`,
      patternType: 'frequency',
      label: `Frequency spike on ${day}`,
      metricCount: count,
      confidence,
      whyFlagged: `${count} incidents occurred on ${day} in this period (${Math.round(support * 100)}% of incidents).`,
      evidenceReferences: takeEvidence(incidents, (incident) => incident.dayOfWeek === day),
      relatedTags: [],
    }));
  }

  for (const [block, count] of byBlock.entries()) {
    if (count < minOccurrences) continue;
    const support = count / incidents.length;
    const confidence = 0.32 + support + (block === 'overnight' ? 0.08 : 0);
    signals.push(createSignal({
      id: `frequency:block:${block}`,
      patternType: 'frequency',
      label: `Time-of-day concentration (${block})`,
      metricCount: count,
      confidence,
      whyFlagged: `${count} incidents were concentrated in the ${block} window.`,
      evidenceReferences: takeEvidence(incidents, (incident) => hourBlock(incident.hourOfDay) === block),
      relatedTags: [],
    }));
  }

  return signals;
}

function buildClusterSignals(incidents: NormalizedIncidentFeature[], minOccurrences: number): PatternSignal[] {
  if (incidents.length === 0) return [];
  const signals: PatternSignal[] = [];
  const tagCounts = new Map<string, number>();

  for (const incident of incidents) {
    const unique = [...new Set(incident.triggerTags)];
    for (const tag of unique) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  for (const [tag, count] of tagCounts.entries()) {
    if (count < minOccurrences) continue;
    if (GENERIC_TAGS.has(tag)) continue;

    const support = count / incidents.length;
    if (support > 0.9 && incidents.length < 12) continue;

    const confidence = 0.4 + (support * 0.65) + (count >= minOccurrences * 2 ? 0.08 : 0);
    signals.push(createSignal({
      id: `cluster:trigger:${tag}`,
      patternType: 'cluster',
      label: `Trigger cluster: ${tag.replace(/-/g, ' ')}`,
      metricCount: count,
      confidence,
      whyFlagged: `Tag "${tag}" appears in ${count} incidents, indicating a recurring trigger theme.`,
      evidenceReferences: takeEvidence(incidents, (incident) => incident.triggerTags.includes(tag)),
      relatedTags: [tag],
    }));
  }

  return signals;
}

function buildRecurrenceSignals(incidents: NormalizedIncidentFeature[], minOccurrences: number): PatternSignal[] {
  if (incidents.length < minOccurrences) return [];
  const windows = [24, 72, 168];
  const sorted = [...incidents].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const signals: PatternSignal[] = [];

  for (const windowHours of windows) {
    let left = 0;
    let bestCount = 0;
    let bestRange: { left: number; right: number } | null = null;

    for (let right = 0; right < sorted.length; right += 1) {
      const rightTs = new Date(sorted[right]!.occurredAt).getTime();
      while (left <= right) {
        const leftTs = new Date(sorted[left]!.occurredAt).getTime();
        if (rightTs - leftTs <= windowHours * 60 * 60 * 1_000) break;
        left += 1;
      }
      const count = right - left + 1;
      if (count > bestCount) {
        bestCount = count;
        bestRange = { left, right };
      }
    }

    if (!bestRange || bestCount < minOccurrences) continue;

    const span = sorted.slice(bestRange.left, bestRange.right + 1);
    const uniqueDays = new Set(span.map((incident) => incident.occurredAt.slice(0, 10))).size;
    if (uniqueDays < 2 && windowHours > 24) continue;

    const confidence = 0.45
      + Math.min(0.24, (bestCount - minOccurrences) * 0.08)
      + (windowHours === 24 ? 0.12 : windowHours === 72 ? 0.08 : 0.04);

    signals.push(createSignal({
      id: `recurrence:${windowHours}h`,
      patternType: 'recurrence',
      label: `Recurrence burst (${windowHours}h window)`,
      metricCount: bestCount,
      confidence,
      whyFlagged: `${bestCount} incidents were recorded within a rolling ${windowHours}-hour window.`,
      evidenceReferences: span.map((incident) => incident.incidentId).slice(0, 12),
      relatedTags: [...new Set(span.flatMap((incident) => incident.triggerTags))].slice(0, 4),
    }));
  }

  return signals;
}

function buildCoOccurrenceSignals(incidents: NormalizedIncidentFeature[], minOccurrences: number): PatternSignal[] {
  if (incidents.length < minOccurrences) return [];
  const signals: PatternSignal[] = [];
  const tagCounts = new Map<string, number>();
  const pairCounts = new Map<string, { count: number; refs: string[]; tags: [string, string] }>();

  for (const incident of incidents) {
    const uniqueTags = [...new Set(incident.triggerTags)].slice(0, 8);
    for (const tag of uniqueTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    for (let i = 0; i < uniqueTags.length; i += 1) {
      for (let j = i + 1; j < uniqueTags.length; j += 1) {
        const a = uniqueTags[i]!;
        const b = uniqueTags[j]!;
        const tags: [string, string] = a < b ? [a, b] : [b, a];
        const key = `${tags[0]}|${tags[1]}`;
        const entry = pairCounts.get(key) ?? { count: 0, refs: [], tags };
        entry.count += 1;
        if (entry.refs.length < 12) entry.refs.push(incident.incidentId);
        pairCounts.set(key, entry);
      }
    }
  }

  for (const entry of pairCounts.values()) {
    if (entry.count < minOccurrences) continue;
    const [a, b] = entry.tags;
    const aCount = tagCounts.get(a) ?? 0;
    const bCount = tagCounts.get(b) ?? 0;

    // False-positive controls: ensure pair has meaningful support and each tag is not too sparse.
    if (aCount < minOccurrences + 1 || bCount < minOccurrences + 1) continue;

    const support = entry.count / incidents.length;
    if (support < 0.15) continue;

    const confidence = 0.35 + (support * 1.15) + (entry.count >= minOccurrences * 2 ? 0.1 : 0);
    signals.push(createSignal({
      id: `cooccurrence:${a}:${b}`,
      patternType: 'co_occurrence',
      label: `Co-occurrence: ${a.replace(/-/g, ' ')} + ${b.replace(/-/g, ' ')}`,
      metricCount: entry.count,
      confidence,
      whyFlagged: `Triggers "${a}" and "${b}" appeared together in ${entry.count} incidents.`,
      evidenceReferences: entry.refs,
      relatedTags: [a, b],
    }));
  }

  return signals;
}

function buildCuriosityInsights(args: {
  incidents: NormalizedIncidentFeature[];
  frequency: PatternSignal[];
  clusters: PatternSignal[];
  recurrence: PatternSignal[];
  coOccurrence: PatternSignal[];
}): IncidentPatternsResponse['insights'] {
  const summaries: string[] = [];
  const exploreNext: IncidentPatternsResponse['insights']['exploreNext'] = [];
  const allSignals = [...args.frequency, ...args.clusters, ...args.recurrence, ...args.coOccurrence];

  if (args.recurrence.length > 0) {
    const strongest = sortSignals(args.recurrence)[0]!;
    summaries.push(`Recurrence signal: ${strongest.metricCount} events in ${strongest.label.toLowerCase()}.`);
    exploreNext.push({
      label: 'Review recurrence window',
      reason: 'Burst recurrence can indicate unresolved immediate triggers.',
      action: `explore_patterns_recurrence:${strongest.id}`,
    });
  }

  if (args.clusters.length > 0) {
    const strongest = sortSignals(args.clusters)[0]!;
    summaries.push(`Trigger cluster: ${strongest.label.replace('Trigger cluster: ', '')} appears repeatedly.`);
    exploreNext.push({
      label: 'Inspect trigger cluster evidence',
      reason: 'Cluster evidence helps identify what to adjust before escalation.',
      action: `explore_patterns_cluster:${strongest.id}`,
    });
  }

  if (args.coOccurrence.length > 0) {
    const strongest = sortSignals(args.coOccurrence)[0]!;
    summaries.push(`Co-occurrence pattern: ${strongest.label.replace('Co-occurrence: ', '')}.`);
    exploreNext.push({
      label: 'Inspect co-occurrence factors',
      reason: 'Combined triggers often need coordinated intervention.',
      action: `explore_patterns_cooccurrence:${strongest.id}`,
    });
  }

  if (args.incidents.length > 0) {
    const highOrCritical = args.incidents.filter((incident) =>
      incident.severity === 'high' || incident.severity === 'critical').length;
    if (highOrCritical > 0) {
      summaries.push(`${highOrCritical} incident(s) are high/critical severity in this window.`);
      exploreNext.push({
        label: 'Review high-severity chronology',
        reason: 'High-severity incidents should be checked for common antecedents and controls.',
        action: 'explore_patterns_high_severity_chronology',
      });
    }
  }

  if (summaries.length === 0 && allSignals.length === 0) {
    summaries.push('No dominant recurrence pattern detected in this period.');
    exploreNext.push({
      label: 'Expand observation window',
      reason: 'A broader date range may reveal slower-moving patterns.',
      action: 'explore_patterns_expand_window',
    });
  }

  return {
    patternInsightSummaries: summaries.slice(0, 4),
    exploreNext: exploreNext.slice(0, 4),
  };
}

function applyIncidentPatternsConfidentiality(args: {
  targetType: PatternTargetType;
  target: PatternTarget;
  normalizedIncidents: NormalizedIncidentFeature[];
  patterns: IncidentPatternsResponse['patterns'];
  insights: IncidentPatternsResponse['insights'];
  scope: ConfidentialityScope;
}): {
  target: PatternTarget;
  normalizedIncidents: NormalizedIncidentFeature[];
  patterns: IncidentPatternsResponse['patterns'];
  insights: IncidentPatternsResponse['insights'];
} {
  if (args.scope === 'restricted') {
    return {
      target: args.target,
      normalizedIncidents: args.normalizedIncidents,
      patterns: args.patterns,
      insights: args.insights,
    };
  }

  const redactSignal = (signal: PatternSignal): PatternSignal => ({
    ...signal,
    label: redactSensitiveText(signal.label),
    whyFlagged: redactSensitiveText(signal.whyFlagged),
    evidenceReferences: signal.evidenceReferences.map((value) => maskIdentifier(value) ?? '[redacted-id]'),
  });

  return {
    target: {
      ...args.target,
      name:
        args.targetType === 'young_person'
          ? (redactPersonName(args.target.name, 'standard') ?? 'Redacted person')
          : redactSensitiveText(args.target.name),
    },
    normalizedIncidents: args.normalizedIncidents.map((incident) => ({
      ...incident,
      location: {
        ...incident.location,
        area: incident.location.area ? redactSensitiveText(incident.location.area) : null,
      },
      involvedRoles: incident.involvedRoles.map((role) => redactSensitiveText(role)),
      outcomes: incident.outcomes.map((outcome) => redactSensitiveText(outcome)),
      evidenceRef: {
        ...incident.evidenceRef,
        entityId: maskIdentifier(incident.evidenceRef.entityId) ?? '[redacted-id]',
      },
    })),
    patterns: {
      frequency: args.patterns.frequency.map(redactSignal),
      clusters: args.patterns.clusters.map(redactSignal),
      recurrence: args.patterns.recurrence.map(redactSignal),
      coOccurrence: args.patterns.coOccurrence.map(redactSignal),
    },
    insights: {
      patternInsightSummaries: args.insights.patternInsightSummaries.map((summary) => redactSensitiveText(summary)),
      exploreNext: args.insights.exploreNext.map((item) => ({
        ...item,
        label: redactSensitiveText(item.label),
        reason: redactSensitiveText(item.reason),
      })),
    },
  };
}

async function resolveYoungPersonScope(args: {
  tenantId: string;
  youngPersonId: string;
}): Promise<PatternScopeDescriptor> {
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
    incidentTaskWhere: {
      youngPersonId: youngPerson.id,
    },
  };
}

async function resolveHomeScope(args: {
  tenantId: string;
  homeId: string;
}): Promise<PatternScopeDescriptor> {
  const home = await prisma.home.findFirst({
    where: {
      id: args.homeId,
      tenantId: args.tenantId,
      isActive: true,
    },
    select: { id: true, name: true },
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
    incidentTaskWhere: {
      OR: [
        { homeId: home.id },
        { youngPerson: { homeId: home.id } },
      ],
    },
  };
}

async function buildIncidentPatterns(args: {
  tenantId: string;
  scope: PatternScopeDescriptor;
  query: IncidentPatternQuery;
  confidentiality: ResolvedConfidentiality;
}): Promise<IncidentPatternsResponse> {
  const { from, to, policyDays } = resolveWindow(args.query);
  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        {
          tenantId: args.tenantId,
          deletedAt: null,
          category: TaskCategory.incident,
          createdAt: { gte: from, lte: to },
        },
        args.scope.incidentTaskWhere,
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      approvalStatus: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      submissionPayload: true,
      homeId: true,
      youngPersonId: true,
      home: { select: { id: true, name: true } },
      youngPerson: { select: { id: true, firstName: true, lastName: true } },
      assignee: {
        select: {
          jobTitle: true,
          role: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: args.query.maxIncidents,
  });

  const normalizedIncidents = tasks.map(normalizeIncident)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  const frequency = filterSignals(
    buildFrequencySignals(normalizedIncidents, args.query.minOccurrences),
    args.query.confidenceThreshold,
    args.query.maxPatterns,
  );
  const clusters = filterSignals(
    buildClusterSignals(normalizedIncidents, args.query.minOccurrences),
    args.query.confidenceThreshold,
    args.query.maxPatterns,
  );
  const recurrence = filterSignals(
    buildRecurrenceSignals(normalizedIncidents, args.query.minOccurrences),
    args.query.confidenceThreshold,
    args.query.maxPatterns,
  );
  const coOccurrence = filterSignals(
    buildCoOccurrenceSignals(normalizedIncidents, args.query.minOccurrences),
    args.query.confidenceThreshold,
    args.query.maxPatterns,
  );

  const allSignals = [...frequency, ...clusters, ...recurrence, ...coOccurrence];
  const uniqueTriggerTags = new Set(normalizedIncidents.flatMap((incident) => incident.triggerTags)).size;
  const insights = buildCuriosityInsights({
    incidents: normalizedIncidents,
    frequency,
    clusters,
    recurrence,
    coOccurrence,
  });
  const scopedPayload = applyIncidentPatternsConfidentiality({
    targetType: args.scope.targetType,
    target: args.scope.target,
    normalizedIncidents,
    patterns: {
      frequency,
      clusters,
      recurrence,
      coOccurrence,
    },
    insights,
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
      confidentialityScope: args.confidentiality.effectiveScope,
      maxIncidents: args.query.maxIncidents,
      minOccurrences: args.query.minOccurrences,
      confidenceThreshold: args.query.confidenceThreshold,
      maxPatterns: args.query.maxPatterns,
    },
    summary: {
      totalIncidents: normalizedIncidents.length,
      flaggedPatterns: allSignals.length,
      highConfidencePatterns: allSignals.filter((signal) => signal.confidence >= 0.75).length,
      latestIncidentAt: normalizedIncidents[normalizedIncidents.length - 1]?.occurredAt ?? null,
      uniqueTriggerTags,
    },
    normalizedIncidents: scopedPayload.normalizedIncidents,
    patterns: scopedPayload.patterns,
    insights: scopedPayload.insights,
  };
}

export async function getYoungPersonIncidentPatterns(
  actorUserId: string,
  youngPersonId: string,
  query: IncidentPatternQuery,
): Promise<IncidentPatternsResponse> {
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
  return buildIncidentPatterns({ tenantId: tenant.tenantId, scope, query, confidentiality });
}

export async function getHomeIncidentPatterns(
  actorUserId: string,
  homeId: string,
  query: IncidentPatternQuery,
): Promise<IncidentPatternsResponse> {
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
  return buildIncidentPatterns({ tenantId: tenant.tenantId, scope, query, confidentiality });
}
