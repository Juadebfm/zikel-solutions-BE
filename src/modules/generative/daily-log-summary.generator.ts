/**
 * Daily-log summarisation: source fetch + prompt + model call.
 *
 * This module owns the "produce a draft" step. The lifecycle (draft -> edit ->
 * commit) lives in generative.service.ts; this module just produces the
 * `generated` blob that the lifecycle persists.
 *
 * Ofsted-defensibility notes baked in here:
 *   - sourceRecordIds is the EXACT list of Task IDs the prompt saw. Auditors
 *     can pull those IDs back from `GenerativeArtifact` and verify them.
 *   - promptVersion is bumped any time the prompt or the structured-output
 *     shape changes. Forensic queries can filter by version.
 *   - If the provider call fails for any reason, we return a deterministic
 *     fallback marked `source: 'fallback'`. The FE shows a "Generated without
 *     AI assistance" badge so reviewers know to treat it as a manual draft.
 */

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { DailyLogSummaryContentSchema } from './generative.schema.js';
import type { DailyLogSummaryContent } from './generative.schema.js';

// ─── Versioning ─────────────────────────────────────────────────────────────

export const DAILY_LOG_SUMMARY_PROMPT_VERSION = 'v1.0.0';

// ─── Public API ─────────────────────────────────────────────────────────────

interface DailyLogSummaryGeneration {
  sourceRecordIds: string[];
  content: DailyLogSummaryContent;
  modelId: string;
  promptVersion: string;
  source: 'model' | 'fallback';
}

/**
 * Fetch the day's daily-log Task rows for {tenant, home, date} and produce a
 * structured summary. Returns the structured `DailyLogSummaryContent` plus
 * provenance fields for the caller to persist on the artifact.
 *
 * If no source logs exist for the date, throws — callers should surface this
 * as 404 NO_SOURCE_RECORDS to the FE rather than generating a hallucinated
 * "nothing happened" summary.
 *
 * If the AI provider is unavailable (no API key, network error, parse error,
 * etc.), returns a deterministic structural fallback so the lifecycle still
 * works. The fallback is clearly marked via `source: 'fallback'`.
 */
export async function generateDailyLogSummary(args: {
  tenantId: string;
  homeId: string;
  date: string; // YYYY-MM-DD
}): Promise<DailyLogSummaryGeneration | { noSourceRecords: true }> {
  const sourceLogs = await fetchDailyLogsForDate({
    tenantId: args.tenantId,
    homeId: args.homeId,
    date: args.date,
  });

  if (sourceLogs.length === 0) {
    return { noSourceRecords: true };
  }

  const sourceRecordIds = sourceLogs.map((log) => log.id);

  // Provider gate. AI_ENABLED + AI_API_KEY together mean a real call is
  // possible. Either missing => fallback path. We don't `try` past env
  // checks so logs are clean (no "intentional fallback" stack traces).
  if (!env.AI_ENABLED || !env.AI_API_KEY) {
    return {
      sourceRecordIds,
      content: buildFallbackContent(sourceLogs),
      modelId: 'fallback',
      promptVersion: DAILY_LOG_SUMMARY_PROMPT_VERSION,
      source: 'fallback',
    };
  }

  try {
    const content = await callModel({
      logs: sourceLogs,
      date: args.date,
      homeId: args.homeId,
    });
    return {
      sourceRecordIds,
      content,
      modelId: env.AI_MODEL,
      promptVersion: DAILY_LOG_SUMMARY_PROMPT_VERSION,
      source: 'model',
    };
  } catch (err) {
    logger.warn({
      msg: 'daily-log summary: model call failed, falling back',
      tenantId: args.tenantId,
      homeId: args.homeId,
      date: args.date,
      err: err instanceof Error ? err.message : 'unknown',
    });
    return {
      sourceRecordIds,
      content: buildFallbackContent(sourceLogs),
      modelId: 'fallback',
      promptVersion: DAILY_LOG_SUMMARY_PROMPT_VERSION,
      source: 'fallback',
    };
  }
}

// ─── Source fetch ───────────────────────────────────────────────────────────

interface SourceLog {
  id: string;
  title: string;
  description: string | null;
  submittedAt: Date | null;
  submissionPayload: unknown;
  youngPersonId: string | null;
  homeId: string | null;
}

async function fetchDailyLogsForDate(args: {
  tenantId: string;
  homeId: string;
  date: string; // YYYY-MM-DD
}): Promise<SourceLog[]> {
  // Date window: [YYYY-MM-DD 00:00 UTC, next-day 00:00 UTC). Daily logs are
  // Task rows with category='daily_log' and submittedAt set to the noteDate.
  const start = new Date(`${args.date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const rows = await prisma.task.findMany({
    where: {
      tenantId: args.tenantId,
      homeId: args.homeId,
      category: 'daily_log',
      deletedAt: null,
      submittedAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      title: true,
      description: true,
      submittedAt: true,
      submissionPayload: true,
      youngPersonId: true,
      homeId: true,
    },
    orderBy: { submittedAt: 'asc' },
  });
  return rows;
}

// ─── Fallback content (deterministic, no AI) ────────────────────────────────

function buildFallbackContent(logs: SourceLog[]): DailyLogSummaryContent {
  const count = logs.length;
  const lines = logs
    .slice(0, 12)
    .map((log) => {
      const time = log.submittedAt
        ? log.submittedAt.toISOString().slice(11, 16)
        : '—';
      const snippet = (log.description ?? '').trim().split('\n')[0]?.slice(0, 120) ?? '';
      return `${time}: ${snippet}`;
    })
    .filter((line) => line.length > 6);

  return {
    shiftHighlights: lines.length > 0 ? lines : ['No log content to highlight.'],
    incidentsOfNote: [],
    safeguardingFlags: [],
    followUpRequired: [],
    freeformSummary:
      `Automatic draft (no AI). ${count} daily log${count === 1 ? '' : 's'} were ` +
      `recorded for this home and date. Please review and edit before committing.`,
    languageSafetyPassed: true,
  };
}

// ─── Model call ─────────────────────────────────────────────────────────────

async function callModel(args: {
  logs: SourceLog[];
  date: string;
  homeId: string;
}): Promise<DailyLogSummaryContent> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    logs: args.logs,
    date: args.date,
  });

  const response = await fetch(`${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    // Provider timeout is enforced at the env level (AI_TIMEOUT_MS).
    signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error('AI provider returned an empty response');
  }
  return parseAndValidate(raw);
}

function parseAndValidate(raw: string): DailyLogSummaryContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI response was not valid JSON');
  }
  // Validate via the same Zod schema the routes use — single source of truth
  // for the content shape.
  const result = DailyLogSummaryContentSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `AI response failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return result.data;
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    'You are an assistant that summarises a day of operational daily-log entries from',
    'a UK residential children\'s home. Your output is reviewed by a human (the home',
    'manager or senior staff) before it is committed and shown to inspectors.',
    '',
    'STRICT RULES:',
    '1. Summarise ONLY the facts present in the supplied logs. Do not invent details,',
    '   names, times, or events.',
    '2. Do not include personally identifying information (full names, addresses,',
    '   phone numbers, DOBs) beyond what is essential to the operational meaning.',
    '3. Use non-blaming, trauma-informed language. Describe behaviour, not character.',
    '   Avoid words like "aggressive", "defiant", "manipulative" — prefer "displayed',
    '   distressed behaviour", "was reluctant to engage", "set firm limits".',
    '4. If any log mentions safeguarding concerns, abuse, neglect, or significant risk',
    '   to a child or young person, add it to safeguardingFlags. Be specific about',
    '   which log raised the concern.',
    '5. followUpRequired is for concrete actions: handover items for the next shift,',
    '   tasks that need to be raised, conversations to follow up. Not vague commitments.',
    '6. languageSafetyPassed should be set to false if the source logs contain',
    '   blaming or stigmatising language and you have neutralised it in your summary.',
    '',
    'Output a JSON object with exactly these keys: shiftHighlights, incidentsOfNote,',
    'safeguardingFlags, followUpRequired, freeformSummary, languageSafetyPassed.',
    'Arrays should contain 0 or more short string entries (max ~500 chars each).',
    'freeformSummary should be 2-4 sentences.',
  ].join('\n');
}

function buildUserPrompt(args: { logs: SourceLog[]; date: string }): string {
  const lines: string[] = [`Date: ${args.date}`, `Total logs: ${args.logs.length}`, ''];

  args.logs.forEach((log, idx) => {
    const time = log.submittedAt
      ? log.submittedAt.toISOString().slice(11, 19)
      : 'unknown';
    lines.push(`--- Log #${idx + 1} (id: ${log.id}, time: ${time}) ---`);
    lines.push(`Title: ${log.title}`);
    if (log.description) {
      // Cap each log description at 1500 chars to bound prompt size while keeping
      // the substance. Long logs are rare; truncation gets a tag so summariser
      // can note incompleteness if it matters.
      const desc = log.description.length > 1500
        ? `${log.description.slice(0, 1500)} ... [truncated]`
        : log.description;
      lines.push(`Note: ${desc}`);
    }
    // Surface the dailyLogCategory if present in submissionPayload.
    const payload = log.submissionPayload as { dailyLogCategory?: string } | null;
    if (payload?.dailyLogCategory) {
      lines.push(`Category: ${payload.dailyLogCategory}`);
    }
    lines.push('');
  });

  lines.push('Produce the JSON summary now.');
  return lines.join('\n');
}
