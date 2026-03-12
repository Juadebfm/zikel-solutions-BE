import { AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getSummaryStats } from '../summary/summary.service.js';
import type { AskAiBody } from './ai.schema.js';

const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_TIMEOUT_MS = 12_000;
const CONTEXT_ITEM_LIMIT = 5;

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

async function resolveSummaryContext(userId: string, body: AskAiBody): Promise<{
  stats: SummaryStatsContext | null;
  statsSource: StatsSource;
  todos: SummaryListItemContext[];
  tasksToApprove: SummaryListItemContext[];
}> {
  const clientStats = body.context?.stats;
  const stats = clientStats ?? (await getSummaryStats(userId));
  const statsSource: StatsSource = clientStats ? 'client' : stats ? 'server' : 'none';

  return {
    stats,
    statsSource,
    todos: body.context?.todos?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
    tasksToApprove: body.context?.tasksToApprove?.slice(0, CONTEXT_ITEM_LIMIT) ?? [],
  };
}

function makeSuggestions(stats: SummaryStatsContext | null) {
  const safe = stats ?? {};
  const suggestions: Array<{ label: string; action: string }> = [];

  if ((safe.overdue ?? 0) > 0) {
    suggestions.push({ label: 'Review overdue tasks', action: 'open_summary_todos_overdue' });
  }
  if ((safe.pendingApproval ?? 0) > 0) {
    suggestions.push({ label: 'Open pending approvals', action: 'open_summary_pending_approvals' });
  }
  if ((safe.dueToday ?? 0) > 0) {
    suggestions.push({ label: 'Check tasks due today', action: 'open_summary_todos_due_today' });
  }
  if (suggestions.length === 0) {
    suggestions.push({ label: 'View all tasks', action: 'open_summary_todos_all' });
  }

  return suggestions.slice(0, 3);
}

function buildFallbackAnswer(query: string, stats: SummaryStatsContext | null): string {
  const safe = stats ?? {};
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

function systemPrompt(): string {
  return [
    'You are an assistant for children-home operations staff.',
    'Be concise, practical, and action oriented.',
    'Use non-blaming language.',
    'Do not fabricate facts and do not provide medical or legal diagnoses.',
    'If data is limited, say what is missing and provide safe next steps.',
  ].join(' ');
}

function userPrompt(body: AskAiBody, context: {
  stats: SummaryStatsContext | null;
  todos: SummaryListItemContext[];
  tasksToApprove: SummaryListItemContext[];
}): string {
  return JSON.stringify(
    {
      instruction: 'Answer the user query using the provided summary context only.',
      query: body.query,
      page: body.page,
      context,
      outputFormat: {
        summary: '1 short paragraph',
        actionItems: 'up to 3 bullet points',
      },
    },
    null,
    2,
  );
}

async function callModel(body: AskAiBody, context: {
  stats: SummaryStatsContext | null;
  todos: SummaryListItemContext[];
  tasksToApprove: SummaryListItemContext[];
}): Promise<{ answer: string; model: string }> {
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
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: userPrompt(body, context) },
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

export async function askAi(userId: string, body: AskAiBody) {
  const summaryContext = await resolveSummaryContext(userId, body);
  const fallbackAnswer = buildFallbackAnswer(body.query, summaryContext.stats);

  let source: AiSource = 'fallback';
  let model: string | null = null;
  let answer = fallbackAnswer;

  try {
    const modelResult = await callModel(body, {
      stats: summaryContext.stats,
      todos: summaryContext.todos,
      tasksToApprove: summaryContext.tasksToApprove,
    });
    source = 'model';
    model = modelResult.model;
    answer = modelResult.answer;
  } catch {
    // Fallback is intentionally silent and non-blocking.
  }

  const suggestions = makeSuggestions(summaryContext.stats);
  const generatedAt = new Date().toISOString();

  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.record_created,
      entityType: 'ai_ask',
      metadata: {
        page: body.page,
        source,
        model,
        queryLength: body.query.length,
        statsSource: summaryContext.statsSource,
        suggestions: suggestions.map((s) => s.action),
      },
    },
  });

  return {
    answer,
    suggestions,
    source,
    model,
    statsSource: summaryContext.statsSource,
    generatedAt,
  };
}
