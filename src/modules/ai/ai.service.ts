import { AuditAction, MembershipStatus, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { getSummaryStats } from '../summary/summary.service.js';
import type { AskAiBody, SetAiAccessBody, AiPage } from './ai.schema.js';

const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_TIMEOUT_MS = 12_000;
const CONTEXT_ITEM_LIMIT = 5;
const PAGE_ITEMS_LIMIT = 20;

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

function toBool(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
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

// ─── Resolved context per page ───────────────────────────────────────────────

type ResolvedContext = {
  stats: SummaryStatsContext | null;
  statsSource: StatsSource;
  todos: SummaryListItemContext[];
  tasksToApprove: SummaryListItemContext[];
  items: PageItemContext[];
  filters: Record<string, string>;
  meta: { total?: number | undefined; page?: number | undefined; pageSize?: number | undefined; totalPages?: number | undefined } | null;
};

async function resolveContext(userId: string, body: AskAiBody): Promise<ResolvedContext> {
  const page = body.page;

  // Summary page: use stats + todos (original behaviour)
  if (page === 'summary') {
    const clientStats = body.context?.stats;
    const stats = clientStats ?? (await getSummaryStats(userId));
    const statsSource: StatsSource = clientStats ? 'client' : stats ? 'server' : 'none';

    return {
      stats,
      statsSource,
      todos: body.context?.todos?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
      tasksToApprove: body.context?.tasksToApprove?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
      items: [],
      filters: {},
      meta: null,
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
  };
}

// ─── Page-specific system prompts ────────────────────────────────────────────

const BASE_RULES = [
  'Be concise, practical, and action oriented.',
  'Use non-blaming language.',
  'Do not fabricate facts and do not provide medical or legal diagnoses.',
  'If data is limited, say what is missing and provide safe next steps.',
].join(' ');

const PAGE_SYSTEM_PROMPTS: Record<AiPage, string> = {
  summary: `You are an assistant for children-home operations staff. You have access to the user's full system summary including task stats, to-do list, and pending approvals. Help them prioritise and plan their day. ${BASE_RULES}`,
  tasks: `You are an assistant for children-home operations staff. You are on the Task Explorer page. You can see the tasks currently displayed, including their status, priority, category, assignees, and due dates. Help the user understand, filter, prioritise, or take action on these tasks. ${BASE_RULES}`,
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

function userPrompt(body: AskAiBody, ctx: ResolvedContext): string {
  if (body.page === 'summary') {
    return JSON.stringify(
      {
        instruction: 'Answer the user query using the provided summary context only.',
        query: body.query,
        page: body.page,
        context: {
          stats: ctx.stats,
          todos: ctx.todos,
          tasksToApprove: ctx.tasksToApprove,
        },
        outputFormat: { summary: '1 short paragraph', actionItems: 'up to 3 bullet points' },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      instruction: `Answer the user query using the provided ${body.page.replace(/_/g, ' ')} page context only. Only reference data that is present in the context.`,
      query: body.query,
      page: body.page,
      context: {
        items: ctx.items,
        filters: ctx.filters,
        meta: ctx.meta,
      },
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

function buildFallbackAnswer(query: string, page: AiPage, ctx: ResolvedContext): string {
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

async function callModel(body: AskAiBody, ctx: ResolvedContext): Promise<{ answer: string; model: string }> {
  const config = aiConfig();

  if (!config.enabled) {
    throw new Error('AI is disabled.');
  }
  if (!config.apiKey) {
    throw new Error('AI API key is missing.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

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
          { role: 'system', content: PAGE_SYSTEM_PROMPTS[body.page] },
          { role: 'user', content: userPrompt(body, ctx) },
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

    return { answer, model: config.model };
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

  const ctx = await resolveContext(userId, body);
  const fallbackAnswer = buildFallbackAnswer(body.query, body.page, ctx);

  let source: AiSource = 'fallback';
  let model: string | null = null;
  let answer = fallbackAnswer;

  try {
    const modelResult = await callModel(body, ctx);
    source = 'model';
    model = modelResult.model;
    answer = modelResult.answer;
  } catch {
    // Fallback is intentionally silent and non-blocking.
  }

  const suggestions = makeSuggestions(body.page, ctx);
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
        suggestions: suggestions.map((s) => s.action),
      },
    },
  });

  return {
    answer,
    suggestions,
    source,
    model,
    statsSource: ctx.statsSource,
    generatedAt,
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
