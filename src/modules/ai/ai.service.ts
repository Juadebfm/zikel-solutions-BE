import {
  AuditAction,
  MembershipStatus,
  TaskApprovalStatus,
  TaskCategory,
  TaskStatus,
  TenantRole,
  UserRole,
} from '@prisma/client';
import {
  parseSensitiveKeySet,
  redactSensitiveText,
  redactStructuredValue,
} from '../../lib/data-protection.js';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext, type TenantContext } from '../../lib/tenant-context.js';
import { getSummaryStats } from '../summary/summary.service.js';
import type { AskAiBody, SetAiAccessBody, AiPage } from './ai.schema.js';

const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_TIMEOUT_MS = 12_000;
const CONTEXT_ITEM_LIMIT = 5;
const PAGE_ITEMS_LIMIT = 20;
const DEFAULT_AI_SENSITIVE_KEYS = [
  'firstName',
  'lastName',
  'middleName',
  'fullName',
  'name',
  'email',
  'phone',
  'phoneNumber',
  'address',
  'dob',
  'dateOfBirth',
  'niNumber',
  'nhsNumber',
  'medical',
  'diagnosis',
  'passport',
].join(',');

type SummaryStatsContext = {
  overdue?: number | undefined;
  dueToday?: number | undefined;
  pendingApproval?: number | undefined;
  rejected?: number | undefined;
  draft?: number | undefined;
  future?: number | undefined;
  comments?: number | undefined;
  rewards?: number | undefined;
};

type SummaryListItemContext = {
  title: string;
  status?: string | undefined;
  priority?: string | undefined;
  dueDate?: string | null | undefined;
};

type PageItemContext = {
  id?: string | undefined;
  title: string;
  status?: string | undefined;
  priority?: string | undefined;
  category?: string | undefined;
  type?: string | undefined;
  dueDate?: string | null | undefined;
  assignee?: string | undefined;
  home?: string | undefined;
  extra?: Record<string, string> | undefined;
};

type AiSource = 'model' | 'fallback';
type StatsSource = 'client' | 'server' | 'none';
type AssistantStrengthProfile = 'owner' | 'admin' | 'staff';
type AssistantResponseMode = 'comprehensive' | 'balanced' | 'focused';
type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';
type AskAiDisplayMode = 'auto' | 'standard' | 'minimal';

type PlatformSnapshot = {
  homes: number;
  careGroups: number;
  youngPeople: number;
  employees: number;
  vehicles: number;
  openTasks: number;
  pendingApprovals: number;
  overdueTasks: number;
  submittedDailyLogs: number;
  rejectedDailyLogs: number;
  openSupportTickets: number;
  unreadAnnouncements: number;
};

type PriorityInsight = {
  id: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  category: string | null;
  type: string | null;
  dueDate: string | null;
  assignee: string | null;
  urgencyScore: number;
  urgencyLevel: UrgencyLevel;
  reasons: string[];
  recommendedAction: string;
};

type RiskInsight = {
  title: string;
  severity: 'medium' | 'high' | 'critical';
  reason: string;
};

type QuickAction = {
  label: string;
  action: string;
  reason: string;
};

type CuriositySuggestion = {
  label: string;
  reason: string;
  action: string;
};

type CuriosityInsight = {
  patternInsightSummaries: string[];
  exploreNext: CuriositySuggestion[];
};

type MinimalResponse = {
  enabled: boolean;
  headline: string;
  focusNow: string[];
  nextLook: string | null;
  reassurance: string;
};

type PromptQaRubric = {
  version: 'pace-language-v1';
  passed: boolean;
  checks: {
    nonBlamingLanguage: boolean;
    avoidsDiagnosisOrLegalConclusion: boolean;
    evidenceGrounded: boolean;
  };
  notes: string[];
};

type LanguageSafety = {
  nonBlamingGuardrailsApplied: boolean;
  flaggedTerms: string[];
  rubric: PromptQaRubric;
};

type AssistantAnalysis = {
  strengthProfile: AssistantStrengthProfile;
  responseMode: AssistantResponseMode;
  contextSummary: {
    page: AiPage;
    visibleItems: number;
    totalVisible: number | null;
    generatedFrom: 'summary_stats' | 'page_items';
  };
  topPriorities: PriorityInsight[];
  risks: RiskInsight[];
  missingData: string[];
  quickActions: QuickAction[];
  curiosity: CuriosityInsight;
  platformSnapshot: PlatformSnapshot | null;
};

function toBool(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

function toBoolWithDefault(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return toBool(raw);
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function aiConfig() {
  return {
    enabled: toBool(process.env.AI_ENABLED),
    apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.AI_MODEL ?? DEFAULT_AI_MODEL,
    timeoutMs: toPositiveInt(process.env.AI_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS),
  };
}

function aiContextRedactionConfig(): AiContextRedactionConfig {
  const enabled = toBoolWithDefault(process.env.AI_CONTEXT_REDACTION_ENABLED, true);
  const mode: AiContextRedactionMode = process.env.AI_CONTEXT_REDACTION_MODE === 'standard'
    ? 'standard'
    : 'strict';
  const base = parseSensitiveKeySet(
    process.env.AI_CONTEXT_REDACTION_SENSITIVE_KEYS ?? DEFAULT_AI_SENSITIVE_KEYS,
  );

  if (mode === 'strict') {
    [
      'id',
      'taskId',
      'entityId',
      'targetId',
      'ownerUserId',
      'userId',
      'youngPersonId',
      'homeId',
      'assignee',
      'home',
    ].forEach((key) => base.add(key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  }

  return { enabled, mode, sensitiveKeys: base };
}

const ACTIVE_WORKFLOW_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function resolveStrengthProfile(tenant: TenantContext): AssistantStrengthProfile {
  if (tenant.userRole === UserRole.super_admin || tenant.tenantRole === TenantRole.tenant_admin) {
    return 'owner';
  }
  if (
    tenant.userRole === UserRole.admin ||
    tenant.userRole === UserRole.manager ||
    tenant.tenantRole === TenantRole.sub_admin
  ) {
    return 'admin';
  }
  return 'staff';
}

function resolveResponseMode(profile: AssistantStrengthProfile): AssistantResponseMode {
  if (profile === 'owner') return 'comprehensive';
  if (profile === 'admin') return 'balanced';
  return 'focused';
}

async function getPlatformSnapshot(args: {
  tenantId: string;
  userId: string;
  profile: AssistantStrengthProfile;
}): Promise<PlatformSnapshot | null> {
  if (args.profile === 'staff') {
    return null;
  }

  const now = new Date();
  const [homes, careGroups, youngPeople, employees, vehicles, openTasks, pendingApprovals, overdueTasks, submittedDailyLogs, rejectedDailyLogs, openSupportTickets, unreadAnnouncements] =
    await Promise.all([
      prisma.home.count({ where: { tenantId: args.tenantId, isActive: true } }),
      prisma.careGroup.count({ where: { tenantId: args.tenantId, isActive: true } }),
      prisma.youngPerson.count({ where: { tenantId: args.tenantId, isActive: true } }),
      prisma.employee.count({ where: { tenantId: args.tenantId, isActive: true } }),
      prisma.vehicle.count({ where: { tenantId: args.tenantId, isActive: true } }),
      prisma.task.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          status: { in: ACTIVE_WORKFLOW_STATUSES },
        },
      }),
      prisma.task.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          approvalStatus: TaskApprovalStatus.pending_approval,
        },
      }),
      prisma.task.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          status: { in: ACTIVE_WORKFLOW_STATUSES },
          dueDate: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          category: TaskCategory.daily_log,
          approvalStatus: TaskApprovalStatus.pending_approval,
        },
      }),
      prisma.task.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          category: TaskCategory.daily_log,
          approvalStatus: TaskApprovalStatus.rejected,
        },
      }),
      prisma.supportTicket.count({
        where: {
          tenantId: args.tenantId,
          status: { in: ['open', 'in_progress', 'waiting_on_customer'] },
        },
      }),
      prisma.announcement.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          publishedAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          reads: { none: { userId: args.userId } },
        },
      }),
    ]);

  const fullSnapshot: PlatformSnapshot = {
    homes,
    careGroups,
    youngPeople,
    employees,
    vehicles,
    openTasks,
    pendingApprovals,
    overdueTasks,
    submittedDailyLogs,
    rejectedDailyLogs,
    openSupportTickets,
    unreadAnnouncements,
  };

  if (args.profile === 'owner') return fullSnapshot;

  return {
    homes: fullSnapshot.homes,
    careGroups: 0,
    youngPeople: fullSnapshot.youngPeople,
    employees: 0,
    vehicles: fullSnapshot.vehicles,
    openTasks: fullSnapshot.openTasks,
    pendingApprovals: fullSnapshot.pendingApprovals,
    overdueTasks: fullSnapshot.overdueTasks,
    submittedDailyLogs: fullSnapshot.submittedDailyLogs,
    rejectedDailyLogs: fullSnapshot.rejectedDailyLogs,
    openSupportTickets: fullSnapshot.openSupportTickets,
    unreadAnnouncements: fullSnapshot.unreadAnnouncements,
  };
}

// ─── Resolved context per page ───────────────────────────────────────────────

type ResolvedContext = {
  stats: SummaryStatsContext | null;
  statsSource: StatsSource;
  todos: SummaryListItemContext[];
  tasksToApprove: SummaryListItemContext[];
  items: PageItemContext[];
  filters: Record<string, string>;
  meta: { total?: number | undefined; page?: number | undefined; pageSize?: number | undefined; totalPages?: number | undefined } | null;
  platformSnapshot: PlatformSnapshot | null;
};

type AiContextRedactionMode = 'standard' | 'strict';

type AiContextRedactionConfig = {
  enabled: boolean;
  mode: AiContextRedactionMode;
  sensitiveKeys: Set<string>;
};

async function resolveContext(args: {
  userId: string;
  body: AskAiBody;
  tenant: TenantContext;
  profile: AssistantStrengthProfile;
}): Promise<ResolvedContext> {
  const { userId, body, tenant, profile } = args;
  const page = body.page;

  // Summary page: use stats + todos (original behaviour)
  if (page === 'summary') {
    const clientStats = body.context?.stats;
    const stats = clientStats ?? (await getSummaryStats(userId));
    const statsSource: StatsSource = clientStats ? 'client' : stats ? 'server' : 'none';
    const platformSnapshot = await getPlatformSnapshot({
      tenantId: tenant.tenantId,
      userId,
      profile,
    });

    return {
      stats,
      statsSource,
      todos: body.context?.todos?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
      tasksToApprove: body.context?.tasksToApprove?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
      items: [],
      filters: {},
      meta: null,
      platformSnapshot,
    };
  }

  // All other pages: use items + filters sent by the FE
  const rawFilters = body.context?.filters;
  const filters: Record<string, string> = {};
  if (rawFilters) {
    for (const [k, v] of Object.entries(rawFilters)) {
      if (typeof v === 'string') filters[k] = v;
    }
  }

  const rawMeta = body.context?.meta;

  return {
    stats: null,
    statsSource: 'none' as StatsSource,
    todos: [],
    tasksToApprove: [],
    items: (body.context?.items?.slice(0, PAGE_ITEMS_LIMIT) ?? []) as PageItemContext[],
    filters,
    meta: rawMeta ? {
      total: rawMeta.total,
      page: rawMeta.page,
      pageSize: rawMeta.pageSize,
      totalPages: rawMeta.totalPages,
    } : null,
    platformSnapshot: null,
  };
}

// ─── Page-specific system prompts ────────────────────────────────────────────

const BASE_RULES = [
  'Be concise, practical, and action oriented.',
  'Use non-blaming, child-centred language.',
  'Do not fabricate facts and do not provide medical or legal diagnoses.',
  'Ground recommendations in visible context evidence only.',
  'If data is limited, say what is missing and provide safe next steps.',
  'Keep tone calm, supportive, and accountability-focused.',
  'IMPORTANT: If the user sends a casual or conversational message (e.g. "hello", "hi", "thanks", "good morning"), respond naturally and briefly — greet them back warmly, and optionally mention 1 quick highlight from their context if relevant. Do NOT dump a full operational briefing for greetings or small talk.',
].join(' ');

const BLAMING_LANGUAGE_RULES: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: 'non_compliant',
    pattern: /\bnon[-\s]?compliant\b/gi,
    replacement: 'finding it hard to engage',
  },
  {
    label: 'attention_seeking',
    pattern: /\battention[-\s]?seeking\b/gi,
    replacement: 'seeking connection or support',
  },
  {
    label: 'manipulative',
    pattern: /\bmanipulative\b/gi,
    replacement: 'using coping strategies to regain control',
  },
  {
    label: 'difficult_child',
    pattern: /\bdifficult child\b/gi,
    replacement: 'child with unmet needs',
  },
  {
    label: 'bad_behaviour',
    pattern: /\bbad behavio[u]?r\b/gi,
    replacement: 'distressed behaviour',
  },
  {
    label: 'defiant',
    pattern: /\bdefiant\b/gi,
    replacement: 'showing resistance',
  },
];

const DIAGNOSIS_OR_LEGAL_PATTERNS = [
  /\bdiagnos(?:e|ed|is|ing)\b/i,
  /\bpersonality disorder\b/i,
  /\bcriminal\b/i,
  /\billegal act\b/i,
  /\bprosecute\b/i,
];

const PAGE_SYSTEM_PROMPTS: Record<AiPage, string> = {
  summary: `You are an assistant for children-home operations staff. You have access to the user's full system summary including task stats, to-do list, and pending approvals. Help them prioritise and plan their day. ${BASE_RULES}`,
  tasks: `You are an assistant for children-home operations staff. You are on the Task Explorer page. You can see the tasks currently displayed, including their status, priority, category, assignees, and due dates. Help the user understand, filter, prioritise, or take action on these tasks. ${BASE_RULES}`,
  daily_logs: `You are an assistant for children-home operations staff. You are on the Daily Logs page. You can see daily log records, who submitted them, their status, and the people or homes they relate to. Help the user review updates, identify gaps, and plan follow-up actions. ${BASE_RULES}`,
  care_groups: `You are an assistant for children-home operations staff. You are on the Care Groups page. Help the user understand the care group structure and answer questions about the groups shown. ${BASE_RULES}`,
  homes: `You are an assistant for children-home operations staff. You are on the Homes page. You can see the homes currently listed with their details. Help the user with questions about homes, capacity, and organisation. ${BASE_RULES}`,
  young_people: `You are an assistant for children-home operations staff. You are on the Young People page. You can see the young people records currently displayed. Help with questions about placements, records, and care needs. ${BASE_RULES}`,
  employees: `You are an assistant for children-home operations staff. You are on the Employees page. You can see employee records. Help with staffing questions, assignments, and workforce queries. ${BASE_RULES}`,
  vehicles: `You are an assistant for children-home operations staff. You are on the Vehicles page. You can see vehicle records including service/MOT dates. Help with fleet management questions. ${BASE_RULES}`,
  form_designer: `You are an assistant for children-home operations staff. You are on the Form Designer page. Help the user understand, create, or manage form templates. ${BASE_RULES}`,
  users: `You are an assistant for children-home operations staff. You are on the Users page. Help with user management questions such as roles, access, and account status. ${BASE_RULES}`,
  audit: `You are an assistant for children-home operations staff. You are on the Audit page. Help the user understand audit log entries and compliance tracking. ${BASE_RULES}`,
};

// ─── Page-specific user prompts ──────────────────────────────────────────────

function roleInstruction(profile: AssistantStrengthProfile, mode: AssistantResponseMode): string {
  if (profile === 'owner') {
    return `Response profile: owner. Mode: ${mode}. Include operational priorities, compliance risks, and cross-platform synthesis.`;
  }
  if (profile === 'admin') {
    return `Response profile: admin. Mode: ${mode}. Focus on immediate operations, blockers, and owner-escalation points.`;
  }
  return `Response profile: staff. Mode: ${mode}. Keep guidance short, practical, and task-level. Avoid strategic/tenant-wide recommendations.`;
}

function resolveDisplayMode(mode: AskAiDisplayMode, profile: AssistantStrengthProfile): 'standard' | 'minimal' {
  if (mode === 'minimal' || mode === 'standard') return mode;
  return profile === 'staff' ? 'minimal' : 'standard';
}

function applyNonBlamingGuardrails(text: string): { text: string; flaggedTerms: string[] } {
  let next = text;
  const flaggedTerms: string[] = [];

  for (const rule of BLAMING_LANGUAGE_RULES) {
    const detector = new RegExp(rule.pattern.source, 'i');
    if (detector.test(next)) flaggedTerms.push(rule.label);
    next = next.replace(rule.pattern, rule.replacement);
  }

  return {
    text: next.replace(/\s{2,}/g, ' ').trim(),
    flaggedTerms: Array.from(new Set(flaggedTerms)),
  };
}

function hasDiagnosisOrLegalLanguage(text: string): boolean {
  return DIAGNOSIS_OR_LEGAL_PATTERNS.some((pattern) => pattern.test(text));
}

function buildPromptQaRubric(args: {
  answer: string;
  analysis: AssistantAnalysis;
}): PromptQaRubric {
  const lower = args.answer.toLowerCase();
  const nonBlamingLanguage = BLAMING_LANGUAGE_RULES.every((rule) => {
    const detector = new RegExp(rule.pattern.source, 'i');
    return !detector.test(lower);
  });
  const avoidsDiagnosisOrLegalConclusion = !hasDiagnosisOrLegalLanguage(lower);

  const hasPriorityAnchor = args.analysis.topPriorities.some((priority) => {
    const anchor = priority.title.toLowerCase().trim();
    if (anchor.length < 6) return false;
    return lower.includes(anchor.slice(0, Math.min(anchor.length, 18)));
  });

  const evidenceCuePattern =
    /\b(based on|from the provided|from the visible|visible context|in the current queue|overdue|pending approval|due today|shown)\b/i;

  const evidenceGrounded =
    args.analysis.contextSummary.visibleItems === 0 ||
    hasPriorityAnchor ||
    evidenceCuePattern.test(lower) ||
    /\d/.test(lower);

  const checks = {
    nonBlamingLanguage,
    avoidsDiagnosisOrLegalConclusion,
    evidenceGrounded,
  };
  const passed =
    checks.nonBlamingLanguage &&
    checks.avoidsDiagnosisOrLegalConclusion &&
    checks.evidenceGrounded;

  const notes: string[] = [];
  if (!checks.nonBlamingLanguage) {
    notes.push('Language should avoid blame labels and remain supportive.');
  }
  if (!checks.avoidsDiagnosisOrLegalConclusion) {
    notes.push('Avoid medical/legal conclusions; keep guidance operational.');
  }
  if (!checks.evidenceGrounded) {
    notes.push('Anchor recommendations in visible evidence or counts.');
  }

  return {
    version: 'pace-language-v1',
    passed,
    checks,
    notes,
  };
}

function normalizeSummaryItems(ctx: ResolvedContext): PageItemContext[] {
  const todoItems = ctx.todos.map((todo, index) => ({
    id: `summary_todo_${index + 1}`,
    title: todo.title,
    status: todo.status ?? 'pending',
    priority: todo.priority,
    dueDate: todo.dueDate,
    type: 'todo',
    category: 'summary',
  }));
  const approvalItems = ctx.tasksToApprove.map((task, index) => ({
    id: `summary_approval_${index + 1}`,
    title: task.title,
    status: task.status ?? 'pending_approval',
    priority: task.priority,
    dueDate: task.dueDate,
    type: 'approval',
    category: 'summary',
  }));

  return [...approvalItems, ...todoItems];
}

function buildCuriosityInsight(args: {
  page: AiPage;
  candidateItems: PageItemContext[];
  topPriorities: PriorityInsight[];
}): CuriosityInsight {
  const summaries: string[] = [];
  const exploreNext: CuriositySuggestion[] = [];

  const statusCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  let overdueCount = 0;
  let unassignedCount = 0;

  const themeMatchers: Array<{ key: string; pattern: RegExp }> = [
    { key: 'medication', pattern: /\bmedication|prn\b/i },
    { key: 'missing_from_home', pattern: /\bmissing|abscond\b/i },
    { key: 'aggression_regulation', pattern: /\baggression|escalation|regulation\b/i },
    { key: 'approvals', pattern: /\bapproval|sign[-\s]?off|review\b/i },
    { key: 'safeguarding', pattern: /\bsafeguard|incident|risk\b/i },
  ];

  for (const item of args.candidateItems) {
    const status = (item.status ?? 'unknown').toLowerCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    if (!item.assignee || item.assignee.trim().length === 0) unassignedCount += 1;

    const due = toIsoOrNull(item.dueDate);
    if (due && new Date(due).getTime() < Date.now()) overdueCount += 1;

    const haystack = `${item.title} ${item.category ?? ''} ${item.type ?? ''}`;
    themeMatchers.forEach((theme) => {
      if (theme.pattern.test(haystack)) {
        themeCounts.set(theme.key, (themeCounts.get(theme.key) ?? 0) + 1);
      }
    });
  }

  const dominantStatus = Array.from(statusCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (dominantStatus && dominantStatus[1] >= 2) {
    summaries.push(`${dominantStatus[1]} item(s) share status "${dominantStatus[0]}".`);
  }
  if (overdueCount > 0) {
    summaries.push(`${overdueCount} item(s) are overdue and may need immediate follow-up.`);
  }
  if (unassignedCount > 0) {
    summaries.push(`${unassignedCount} item(s) have no assignee, which may slow completion.`);
  }

  const dominantTheme = Array.from(themeCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (dominantTheme && dominantTheme[1] >= 2) {
    summaries.push(`Repeated "${dominantTheme[0].replace(/_/g, ' ')}" signals appear across ${dominantTheme[1]} item(s).`);
  }

  if (overdueCount > 0) {
    exploreNext.push({
      label: 'Explore overdue cluster',
      reason: 'Overdue work is a repeat operational risk signal.',
      action: `explore_${args.page}_overdue_cluster`,
    });
  }
  if (unassignedCount > 0) {
    exploreNext.push({
      label: 'Explore unassigned workload',
      reason: 'Unassigned high-risk work can stall safeguarding follow-up.',
      action: `explore_${args.page}_unassigned_items`,
    });
  }
  if (dominantTheme) {
    exploreNext.push({
      label: `Explore ${dominantTheme[0].replace(/_/g, ' ')} trend`,
      reason: 'Trend recurrence can reveal upstream triggers.',
      action: `explore_${args.page}_${dominantTheme[0]}_trend`,
    });
  }

  const topPriority = args.topPriorities[0];
  if (topPriority) {
    exploreNext.push({
      label: 'Review top priority evidence',
      reason: `Confirm evidence behind "${topPriority.title}" before closure.`,
      action: `explore_${args.page}_top_priority_evidence`,
    });
  }

  if (summaries.length === 0 && args.candidateItems.length > 0) {
    summaries.push('No dominant risk pattern detected yet; monitor recurrence over the next shift.');
  }

  return {
    patternInsightSummaries: summaries.slice(0, 3),
    exploreNext: exploreNext.slice(0, 3),
  };
}

function toUrgencyLevel(score: number): UrgencyLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function recommendedAction(args: {
  item: PageItemContext;
  urgencyLevel: UrgencyLevel;
  page: AiPage;
}): string {
  const title = args.item.title;
  if (args.urgencyLevel === 'critical') {
    return `Triage "${title}" immediately and assign clear ownership now.`;
  }
  if (args.urgencyLevel === 'high') {
    return `Address "${title}" in this shift and confirm completion evidence.`;
  }
  if (args.page === 'daily_logs') {
    return `Review "${title}" and ensure any missing daily-log detail is completed.`;
  }
  return `Schedule "${title}" in today's working plan and monitor progress.`;
}

function scoreItem(args: { item: PageItemContext; page: AiPage }): PriorityInsight {
  const { item, page } = args;
  const reasons: string[] = [];
  let score = 0;

  const priority = (item.priority ?? '').toLowerCase();
  if (priority === 'urgent') {
    score += 42;
    reasons.push('Marked urgent');
  } else if (priority === 'high') {
    score += 30;
    reasons.push('Marked high priority');
  } else if (priority === 'medium') {
    score += 16;
  } else if (priority === 'low') {
    score += 8;
  }

  const status = (item.status ?? '').toLowerCase();
  if (status.includes('rejected')) {
    score += 38;
    reasons.push('Previously rejected');
  }
  if (status.includes('pending_approval') || status.includes('pending approval')) {
    score += 28;
    reasons.push('Waiting for approval');
  }
  if (status === 'pending' || status === 'in_progress' || status === 'in progress') {
    score += 16;
  }

  const due = toIsoOrNull(item.dueDate);
  if (due) {
    const dueDate = new Date(due);
    const hours = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hours < 0) {
      score += 34;
      reasons.push('Overdue');
    } else if (hours <= 24) {
      score += 24;
      reasons.push('Due within 24 hours');
    } else if (hours <= 72) {
      score += 12;
      reasons.push('Due within 72 hours');
    }
  }

  if (!item.assignee || item.assignee.trim().length === 0) {
    score += 8;
    reasons.push('No assignee');
  }

  const text = `${item.title} ${item.category ?? ''} ${item.type ?? ''}`.toLowerCase();
  if (
    text.includes('incident') ||
    text.includes('safeguard') ||
    text.includes('medication') ||
    text.includes('compliance')
  ) {
    score += 22;
    reasons.push('Safeguarding/compliance-sensitive');
  }

  if (page === 'daily_logs' && status.includes('submitted')) {
    score += 12;
    reasons.push('Submitted log still needs review');
  }

  if (status === 'completed' || status === 'approved') {
    score = Math.max(0, score - 35);
  }

  score = Math.max(0, Math.min(100, score));
  const urgencyLevel = toUrgencyLevel(score);

  return {
    id: item.id ?? null,
    title: item.title,
    status: item.status ?? null,
    priority: item.priority ?? null,
    category: item.category ?? null,
    type: item.type ?? null,
    dueDate: due,
    assignee: item.assignee ?? null,
    urgencyScore: score,
    urgencyLevel,
    reasons: reasons.length > 0 ? reasons : ['General operational follow-up needed'],
    recommendedAction: recommendedAction({ item, urgencyLevel, page }),
  };
}

function buildAnalysis(args: {
  body: AskAiBody;
  ctx: ResolvedContext;
  profile: AssistantStrengthProfile;
  mode: AssistantResponseMode;
  suggestions: Array<{ label: string; action: string }>;
}): AssistantAnalysis {
  const { body, ctx, profile, mode, suggestions } = args;
  const candidateItems = body.page === 'summary' ? normalizeSummaryItems(ctx) : ctx.items;
  const scored = candidateItems
    .map((item) => scoreItem({ item, page: body.page }))
    .sort((a, b) => b.urgencyScore - a.urgencyScore);

  const priorityLimit = profile === 'owner' ? 5 : profile === 'admin' ? 4 : 2;
  const topPriorities = scored.slice(0, priorityLimit);

  const risks: RiskInsight[] = topPriorities
    .filter((item) => item.urgencyLevel !== 'low')
    .slice(0, 4)
    .map((item) => ({
      title: item.title,
      severity:
        item.urgencyLevel === 'critical'
          ? 'critical'
          : item.urgencyLevel === 'high'
            ? 'high'
            : 'medium',
      reason: item.reasons[0] ?? 'Requires attention.',
    }));

  const missingDataSet = new Set<string>();
  topPriorities.forEach((item) => {
    if (!item.assignee) missingDataSet.add('Some high-priority items do not have an assignee.');
    if (!item.dueDate) missingDataSet.add('Some high-priority items do not have a due date.');
    if (!item.status) missingDataSet.add('Some high-priority items do not have a clear workflow status.');
  });
  const missingData = Array.from(missingDataSet).slice(0, profile === 'staff' ? 1 : 3);

  const quickActions: QuickAction[] = suggestions.slice(0, 3).map((suggestion, index) => ({
    label: suggestion.label,
    action: suggestion.action,
    reason:
      topPriorities[index]?.recommendedAction ??
      (profile === 'staff'
        ? 'Use this to complete immediate task work.'
        : 'Use this to move the highest-risk queue first.'),
  }));

  const curiosity = buildCuriosityInsight({
    page: body.page,
    candidateItems,
    topPriorities,
  });

  return {
    strengthProfile: profile,
    responseMode: mode,
    contextSummary: {
      page: body.page,
      visibleItems: candidateItems.length,
      totalVisible:
        body.page === 'summary'
          ? (ctx.platformSnapshot?.openTasks ?? null)
          : (ctx.meta?.total ?? null),
      generatedFrom: body.page === 'summary' ? 'summary_stats' : 'page_items',
    },
    topPriorities,
    risks,
    missingData,
    quickActions,
    curiosity,
    platformSnapshot: ctx.platformSnapshot,
  };
}

function buildMinimalResponse(args: {
  displayMode: 'standard' | 'minimal';
  analysis: AssistantAnalysis;
  suggestions: Array<{ label: string; action: string }>;
}): MinimalResponse {
  const top = args.analysis.topPriorities[0];
  const headline = top
    ? `Start with "${top.title}".`
    : 'No urgent blockers are currently visible.';

  const focusNow =
    args.analysis.topPriorities.length > 0
      ? args.analysis.topPriorities.slice(0, 2).map((priority) => priority.recommendedAction)
      : ['Check today’s open queue and confirm priorities for this shift.'];

  const nextLook =
    args.analysis.curiosity.exploreNext[0]?.label ??
    args.suggestions[0]?.label ??
    null;

  return {
    enabled: args.displayMode === 'minimal',
    headline,
    focusNow,
    nextLook,
    reassurance:
      'Use one step at a time. Keep notes factual, child-centred, and evidence-linked.',
  };
}

function enforceAnswerSafety(args: {
  answer: string;
  fallbackAnswer: string;
  analysis: AssistantAnalysis;
}): { answer: string; languageSafety: LanguageSafety } {
  const guardedAnswer = applyNonBlamingGuardrails(args.answer);
  let safeAnswer = guardedAnswer.text;
  const flaggedTerms = [...guardedAnswer.flaggedTerms];

  if (hasDiagnosisOrLegalLanguage(safeAnswer)) {
    safeAnswer = `${safeAnswer} Keep interpretation operational and avoid medical or legal conclusions.`;
  }

  let rubric = buildPromptQaRubric({
    answer: safeAnswer,
    analysis: args.analysis,
  });

  if (!rubric.passed) {
    const fallbackGuarded = applyNonBlamingGuardrails(args.fallbackAnswer);
    safeAnswer = fallbackGuarded.text;
    flaggedTerms.push(...fallbackGuarded.flaggedTerms);
    rubric = buildPromptQaRubric({
      answer: safeAnswer,
      analysis: args.analysis,
    });
  }

  return {
    answer: safeAnswer,
    languageSafety: {
      nonBlamingGuardrailsApplied: flaggedTerms.length > 0,
      flaggedTerms: Array.from(new Set(flaggedTerms)),
      rubric,
    },
  };
}

function redactModelInput(args: {
  body: AskAiBody;
  ctx: ResolvedContext;
  analysis: AssistantAnalysis;
  redactionConfig: AiContextRedactionConfig;
}): {
  body: AskAiBody;
  ctx: ResolvedContext;
  analysis: AssistantAnalysis;
  redactionApplied: boolean;
  redactionMode: AiContextRedactionMode | 'off';
} {
  if (!args.redactionConfig.enabled) {
    return {
      body: args.body,
      ctx: args.ctx,
      analysis: args.analysis,
      redactionApplied: false,
      redactionMode: 'off',
    };
  }

  const scope = 'standard' as const;
  const redactedBody: AskAiBody = {
    ...args.body,
    query:
      args.redactionConfig.mode === 'strict'
        ? redactSensitiveText(args.body.query)
        : args.body.query,
  };

  const redactedCtx = redactStructuredValue({
    value: args.ctx,
    scope,
    sensitiveKeys: args.redactionConfig.sensitiveKeys,
  }) as ResolvedContext;

  const redactedAnalysis = redactStructuredValue({
    value: args.analysis,
    scope,
    sensitiveKeys: args.redactionConfig.sensitiveKeys,
  }) as AssistantAnalysis;

  return {
    body: redactedBody,
    ctx: redactedCtx,
    analysis: redactedAnalysis,
    redactionApplied: true,
    redactionMode: args.redactionConfig.mode,
  };
}

function userPrompt(args: {
  body: AskAiBody;
  ctx: ResolvedContext;
  analysis: AssistantAnalysis;
  roleInstructionText: string;
}): string {
  const { body, ctx, analysis, roleInstructionText } = args;
  if (body.page === 'summary') {
    return JSON.stringify(
      {
        instruction: 'Answer the user query using the provided summary context only.',
        roleInstruction: roleInstructionText,
        query: body.query,
        page: body.page,
        displayMode: body.displayMode,
        context: {
          stats: ctx.stats,
          todos: ctx.todos,
          tasksToApprove: ctx.tasksToApprove,
          platformSnapshot: ctx.platformSnapshot,
        },
        deterministicAnalysis: analysis,
        outputFormat: { summary: '1 short paragraph', actionItems: 'up to 3 bullet points' },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      instruction: `Answer the user query using the provided ${body.page.replace(/_/g, ' ')} page context only. Only reference data that is present in the context.`,
      roleInstruction: roleInstructionText,
      query: body.query,
      page: body.page,
      displayMode: body.displayMode,
      context: {
        items: ctx.items,
        filters: ctx.filters,
        meta: ctx.meta,
      },
      deterministicAnalysis: analysis,
      outputFormat: { summary: '1 short paragraph', actionItems: 'up to 3 bullet points' },
    },
    null,
    2,
  );
}

// ─── Page-specific suggestions ───────────────────────────────────────────────

function makeSuggestions(page: AiPage, ctx: ResolvedContext) {
  const suggestions: Array<{ label: string; action: string }> = [];

  if (page === 'summary') {
    const safe = ctx.stats ?? {};
    if ((safe.overdue ?? 0) > 0) suggestions.push({ label: 'Review overdue tasks', action: 'open_summary_todos_overdue' });
    if ((safe.pendingApproval ?? 0) > 0) suggestions.push({ label: 'Open pending approvals', action: 'open_summary_pending_approvals' });
    if ((safe.dueToday ?? 0) > 0) suggestions.push({ label: 'Check tasks due today', action: 'open_summary_todos_due_today' });
    if (suggestions.length === 0) suggestions.push({ label: 'View all tasks', action: 'open_summary_todos_all' });
    return suggestions.slice(0, 3);
  }

  const PAGE_SUGGESTIONS: Record<string, Array<{ label: string; action: string }>> = {
    tasks: [
      { label: 'Filter by overdue', action: 'filter_tasks_overdue' },
      { label: 'Filter by pending approval', action: 'filter_tasks_pending_approval' },
      { label: 'Create a new task', action: 'create_task' },
    ],
    daily_logs: [
      { label: 'Show submitted logs', action: 'filter_daily_logs_submitted' },
      { label: 'Show rejected logs', action: 'filter_daily_logs_rejected' },
      { label: 'Create a daily log', action: 'create_daily_log' },
    ],
    care_groups: [
      { label: 'View all care groups', action: 'view_all_care_groups' },
      { label: 'Create a care group', action: 'create_care_group' },
    ],
    homes: [
      { label: 'View all homes', action: 'view_all_homes' },
      { label: 'Add a new home', action: 'create_home' },
    ],
    young_people: [
      { label: 'View all young people', action: 'view_all_young_people' },
      { label: 'Add a young person', action: 'create_young_person' },
    ],
    employees: [
      { label: 'View all employees', action: 'view_all_employees' },
      { label: 'Add an employee', action: 'create_employee' },
    ],
    vehicles: [
      { label: 'Check upcoming MOT', action: 'filter_vehicles_mot_due' },
      { label: 'Check upcoming services', action: 'filter_vehicles_service_due' },
      { label: 'Add a vehicle', action: 'create_vehicle' },
    ],
    form_designer: [
      { label: 'View all forms', action: 'view_all_forms' },
      { label: 'Create a form', action: 'create_form' },
    ],
    users: [
      { label: 'View all users', action: 'view_all_users' },
      { label: 'Invite a user', action: 'invite_user' },
    ],
    audit: [
      { label: 'View recent activity', action: 'view_recent_audit' },
      { label: 'Filter by action type', action: 'filter_audit_action' },
    ],
  };

  return (PAGE_SUGGESTIONS[page] ?? [{ label: 'Ask another question', action: 'ask_again' }]).slice(0, 3);
}

// ─── Page-specific fallback answers ──────────────────────────────────────────

const CASUAL_PATTERN = /^\s*(h(ello|i|ey|owdy)|good\s*(morning|afternoon|evening)|thanks?(\s+you)?|yo|sup|what'?s?\s*up|cheers|welcome)\s*[.!?]*\s*$/i;

function buildFallbackAnswer(args: {
  query: string;
  page: AiPage;
  ctx: ResolvedContext;
  analysis: AssistantAnalysis;
}): string {
  const { query, page, ctx, analysis } = args;

  // Don't dump a full briefing for greetings.
  if (CASUAL_PATTERN.test(query)) {
    const overdue = (ctx.stats as SummaryStatsContext | null)?.overdue ?? 0;
    const highlight = overdue > 0
      ? ` You have ${overdue} overdue task${overdue === 1 ? '' : 's'} — let me know if you'd like help prioritising.`
      : ' Everything looks on track. How can I help you today?';
    return `Hello!${highlight}`;
  }

  if (analysis.topPriorities.length > 0) {
    const focus = analysis.topPriorities
      .slice(0, analysis.strengthProfile === 'staff' ? 1 : 2)
      .map((item) => `"${item.title}" (${item.urgencyLevel})`)
      .join(' and ');

    const riskSummary =
      analysis.risks.length > 0
        ? ` Key risk: ${analysis.risks[0]?.reason}.`
        : '';

    return `For "${query}", prioritize ${focus}.${riskSummary}`;
  }

  if (page === 'summary') {
    const safe = ctx.stats ?? {};
    const counts = [
      { label: 'overdue tasks', value: safe.overdue ?? 0 },
      { label: 'tasks due today', value: safe.dueToday ?? 0 },
      { label: 'pending approvals', value: safe.pendingApproval ?? 0 },
      { label: 'rejected tasks', value: safe.rejected ?? 0 },
      { label: 'draft tasks', value: safe.draft ?? 0 },
      { label: 'future tasks', value: safe.future ?? 0 },
    ];
    const priority = counts.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);

    if (priority.length === 0) {
      return `No urgent items are currently visible in your summary. For "${query}", start with today's tasks and new approvals.`;
    }

    const top = priority
      .slice(0, 2)
      .map((item) => `${item.value} ${item.label}`)
      .join(' and ');

    return `For "${query}", your immediate focus should be ${top}.`;
  }

  const itemCount = ctx.items.length;
  const totalCount = ctx.meta?.total;
  const pageName = page.replace(/_/g, ' ');

  if (itemCount === 0) {
    return `No items are currently visible on the ${pageName} page. Try adjusting your filters or search to find what you're looking for.`;
  }

  const countLabel = totalCount != null ? `${totalCount} total records` : `${itemCount} items currently shown`;
  return `For "${query}", I can see ${countLabel} on the ${pageName} page. Please ask a more specific question about the data shown, and I'll do my best to help.`;
}

async function callModel(args: {
  body: AskAiBody;
  ctx: ResolvedContext;
  analysis: AssistantAnalysis;
  roleInstructionText: string;
  redactionConfig: AiContextRedactionConfig;
}): Promise<{
  answer: string;
  model: string;
  redactionApplied: boolean;
  redactionMode: AiContextRedactionMode | 'off';
}> {
  const { body, ctx, analysis, roleInstructionText } = args;
  const config = aiConfig();

  if (!config.enabled) {
    throw new Error('AI is disabled.');
  }
  if (!config.apiKey) {
    throw new Error('AI API key is missing.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const modelInput = redactModelInput({
    body,
    ctx,
    analysis,
    redactionConfig: args.redactionConfig,
  });

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              `${PAGE_SYSTEM_PROMPTS[body.page]} ${roleInstructionText} ` +
              'PACE guardrails: keep wording non-blaming (acceptance), identify repeat signals to explore (curiosity), ' +
              'keep summaries child-centred where relevant (empathy), and keep output easy to scan for low cognitive load (playfulness).',
          },
          {
            role: 'user',
            content: userPrompt({
              body: modelInput.body,
              ctx: modelInput.ctx,
              analysis: modelInput.analysis,
              roleInstructionText,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed (${response.status}).`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const answer = json.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error('AI provider returned an empty response.');
    }

    return {
      answer,
      model: config.model,
      redactionApplied: modelInput.redactionApplied,
      redactionMode: modelInput.redactionMode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertAiAccessEnabled(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      aiAccessEnabled: true,
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  if (!user.aiAccessEnabled) {
    throw httpError(403, 'AI_ACCESS_DISABLED', 'AI access is not enabled for this account.');
  }
}

export async function askAi(userId: string, body: AskAiBody) {
  const tenant = await requireTenantContext(userId);
  await assertAiAccessEnabled(userId);
  const strengthProfile = resolveStrengthProfile(tenant);
  const responseMode = resolveResponseMode(strengthProfile);
  const displayMode = resolveDisplayMode(body.displayMode, strengthProfile);
  const redactionConfig = aiContextRedactionConfig();

  const ctx = await resolveContext({
    userId,
    body,
    tenant,
    profile: strengthProfile,
  });
  const suggestions = makeSuggestions(body.page, ctx);
  const analysis = buildAnalysis({
    body,
    ctx,
    profile: strengthProfile,
    mode: responseMode,
    suggestions,
  });
  const roleInstructionText = roleInstruction(strengthProfile, responseMode);
  const fallbackAnswer = buildFallbackAnswer({
    query: body.query,
    page: body.page,
    ctx,
    analysis,
  });

  let source: AiSource = 'fallback';
  let model: string | null = null;
  let answer = fallbackAnswer;
  let modelPromptRedactionApplied = false;
  let modelPromptRedactionMode: AiContextRedactionMode | 'off' = redactionConfig.enabled
    ? redactionConfig.mode
    : 'off';

  try {
    const modelResult = await callModel({
      body,
      ctx,
      analysis,
      roleInstructionText,
      redactionConfig,
    });
    source = 'model';
    model = modelResult.model;
    answer = modelResult.answer;
    modelPromptRedactionApplied = modelResult.redactionApplied;
    modelPromptRedactionMode = modelResult.redactionMode;
  } catch {
    // Fallback is intentionally silent and non-blocking.
  }

  const { answer: safeAnswer, languageSafety } = enforceAnswerSafety({
    answer,
    fallbackAnswer,
    analysis,
  });
  const minimalResponse = buildMinimalResponse({
    displayMode,
    analysis,
    suggestions,
  });

  const generatedAt = new Date().toISOString();

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId,
      action: AuditAction.record_created,
      entityType: 'ai_ask',
      metadata: {
        page: body.page,
        source,
        model,
        queryLength: body.query.length,
        statsSource: ctx.statsSource,
        strengthProfile,
        responseMode,
        displayMode,
        modelPromptRedactionApplied,
        modelPromptRedactionMode,
        promptQaPassed: languageSafety.rubric.passed,
        languageGuardrailApplied: languageSafety.nonBlamingGuardrailsApplied,
        topPrioritiesCount: analysis.topPriorities.length,
        suggestions: suggestions.map((s) => s.action),
      },
    },
  });

  return {
    answer: safeAnswer,
    suggestions,
    source,
    model,
    statsSource: ctx.statsSource,
    generatedAt,
    minimalResponse,
    languageSafety,
    promptQa: languageSafety.rubric,
    analysis,
  };
}

export async function setUserAiAccess(actorUserId: string, targetUserId: string, body: SetAiAccessBody) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true },
  });
  if (!actor) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  let auditTenantId: string | null = null;
  if (actor.role !== UserRole.super_admin) {
    const tenant = await requireTenantContext(actorUserId);
    auditTenantId = tenant.tenantId;

    const membership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: tenant.tenantId,
          userId: targetUserId,
        },
      },
      select: { status: true },
    });

    if (!membership || membership.status !== MembershipStatus.active) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
    }
  } else {
    const existingUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!existingUser) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { aiAccessEnabled: body.enabled },
    select: {
      id: true,
      aiAccessEnabled: true,
      updatedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: auditTenantId,
      userId: actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'user_ai_access',
      entityId: targetUserId,
      metadata: { enabled: body.enabled },
    },
  });

  return {
    userId: updated.id,
    aiAccessEnabled: updated.aiAccessEnabled,
    updatedAt: updated.updatedAt,
  };
}
