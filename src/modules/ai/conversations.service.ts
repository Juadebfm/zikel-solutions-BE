/**
 * Phase 8.2 — Conversational AI service.
 *
 * Pure free-form, multi-turn chat. Conversations are user-scoped (many per
 * user, ChatGPT-sidebar style). On each user turn the FULL recent history is
 * sent to the model so the user can redirect the discussion at any point.
 *
 * Decisions locked in payment.md:
 *   - Q-Conv-1: NO streaming — full response in one chunk.
 *   - Q-Conv-2: Conversations kept forever (archive, not delete-by-default).
 *   - Q-Conv-3: Pure free-form — NO page context binding.
 *   - Q-Conv-4: User-scoped, many per user.
 *   - Q-Conv-5: Same quota as /ai/ask + chronology AI (single tenant pool).
 *
 * Quota machinery lands in Phase 7.4. For now, gating goes through
 * `assertAiEnabledForRequest` which already enforces tenant + user toggles.
 */

import {
  AiCallStatus,
  AiCallSurface,
  AiMessageRole,
  type AiConversation,
  type AiMessage,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  assertAiEnabledForRequest,
  recordAiCall,
} from '../../lib/ai-access.js';
import { debitQuota, requireAvailableQuota } from '../../lib/quota.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Cap on how many recent messages we send to the model. Conversations grow
 * unbounded in DB (kept forever per Q-Conv-2) but input tokens cost money,
 * so we send a sliding window. 20 messages ≈ 10 user/assistant pairs ≈ ~6k
 * tokens for typical chat.
 */
const HISTORY_WINDOW_MESSAGES = 20;

const CHAT_TEMPERATURE = 0.7;
const CHAT_MAX_TOKENS = 600;
const CHAT_TIMEOUT_MS = 12_000;

/**
 * Title-generation is a tiny secondary call after the first user→assistant
 * exchange. Cheap (~50 tokens output). Counts against quota as
 * `surface=chat_title`.
 */
const TITLE_TEMPERATURE = 0.5;
const TITLE_MAX_TOKENS = 30;

const SYSTEM_PROMPT = [
  "You are an assistant for staff at a UK children's care home using the Zikel platform.",
  'Be conversational, helpful, and direct. Speak in plain language without jargon or clinical tone.',
  'You can help with anything related to running a care home: rotas, daily logs, incidents, safeguarding, reports, training questions, general operational queries, and questions about how to use the Zikel platform.',
  'When asked about specific data in the platform, point the user to the relevant page rather than guessing — you do not have direct access to their tenant data in this conversation.',
  'Use British English. Keep responses concise unless the user asks for detail.',
].join(' ');

const TITLE_SYSTEM_PROMPT =
  'Summarise the following conversation in 4–6 words for a sidebar title. Return only the title text — no quotes, no punctuation at the end.';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function aiConfig() {
  return {
    enabled: env.AI_ENABLED,
    apiKey: env.AI_API_KEY,
    baseUrl: env.AI_BASE_URL.replace(/\/+$/, ''),
    model: env.AI_MODEL,
    timeoutMs: CHAT_TIMEOUT_MS,
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CallChatModelResult {
  answer: string | null;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  errorReason: string | null;
}

async function callChatModel(args: {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}): Promise<CallChatModelResult> {
  const config = aiConfig();
  if (!config.enabled || !config.apiKey) {
    return {
      answer: null,
      model: config.model,
      tokensIn: null,
      tokensOut: null,
      errorReason: !config.enabled ? 'ai_disabled' : 'api_key_missing',
    };
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
        temperature: args.temperature,
        max_tokens: args.maxTokens,
        messages: args.messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        answer: null,
        model: config.model,
        tokensIn: null,
        tokensOut: null,
        errorReason: `provider_status_${response.status}`,
      };
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const answer = json.choices?.[0]?.message?.content?.trim();
    return {
      answer: answer || null,
      model: config.model,
      tokensIn: typeof json.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : null,
      tokensOut: typeof json.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : null,
      errorReason: answer ? null : 'empty_content',
    };
  } catch (err) {
    return {
      answer: null,
      model: config.model,
      tokensIn: null,
      tokensOut: null,
      errorReason: err instanceof Error ? err.message : 'unknown',
    };
  } finally {
    clearTimeout(timeout);
  }
}

const FALLBACK_REPLY =
  'I am not available right now — please try again in a moment. If this keeps happening, contact your administrator.';

function mapMessage(message: AiMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    fallbackUsed: message.fallbackUsed,
    createdAt: message.createdAt,
  };
}

function mapConversation(
  conversation: AiConversation,
  opts?: { messages?: AiMessage[] },
) {
  return {
    id: conversation.id,
    title: conversation.title,
    archivedAt: conversation.archivedAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(opts?.messages
      ? { messages: opts.messages.map(mapMessage) }
      : {}),
  };
}

async function loadConversationOwned(args: {
  conversationId: string;
  userId: string;
  tenantId: string;
}): Promise<AiConversation> {
  const conversation = await prisma.aiConversation.findFirst({
    where: {
      id: args.conversationId,
      userId: args.userId,
      tenantId: args.tenantId,
    },
  });
  if (!conversation) {
    throw httpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  }
  return conversation;
}

// ─── Public service surface ─────────────────────────────────────────────────

export async function createConversation(args: {
  userId: string;
}): Promise<ReturnType<typeof mapConversation>> {
  const access = await assertAiEnabledForRequest({
    userId: args.userId,
    surface: AiCallSurface.chat,
  });
  const created = await prisma.aiConversation.create({
    data: {
      tenantId: access.tenantId,
      userId: args.userId,
    },
  });
  return mapConversation(created);
}

export async function listConversations(args: {
  userId: string;
  page: number;
  pageSize: number;
  includeArchived: boolean;
}) {
  // We don't gate listing on AI access — a user who had AI access yesterday
  // but lost it today should still be able to read their own past
  // conversations. Sending new messages goes through the gate.
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: { activeTenantId: true },
  });
  if (!user || !user.activeTenantId) {
    throw httpError(403, 'TENANT_REQUIRED', 'An active tenant is required.');
  }

  const where = {
    tenantId: user.activeTenantId,
    userId: args.userId,
    ...(args.includeArchived ? {} : { archivedAt: null }),
  };

  const [total, rows] = await Promise.all([
    prisma.aiConversation.count({ where }),
    prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
    }),
  ]);

  return {
    data: rows.map((c) => mapConversation(c)),
    meta: {
      total,
      page: args.page,
      pageSize: args.pageSize,
      totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
    },
  };
}

export async function getConversation(args: {
  userId: string;
  conversationId: string;
}) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: { activeTenantId: true },
  });
  if (!user || !user.activeTenantId) {
    throw httpError(403, 'TENANT_REQUIRED', 'An active tenant is required.');
  }
  const conversation = await loadConversationOwned({
    conversationId: args.conversationId,
    userId: args.userId,
    tenantId: user.activeTenantId,
  });
  const messages = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
  });
  return mapConversation(conversation, { messages });
}

export async function postMessage(args: {
  userId: string;
  conversationId: string;
  content: string;
}) {
  const access = await assertAiEnabledForRequest({
    userId: args.userId,
    surface: AiCallSurface.chat,
  });
  const conversation = await loadConversationOwned({
    conversationId: args.conversationId,
    userId: args.userId,
    tenantId: access.tenantId,
  });
  if (conversation.archivedAt) {
    throw httpError(409, 'CONVERSATION_ARCHIVED', 'Cannot post to an archived conversation. Unarchive it first.');
  }

  // Phase 7.4: quota check BEFORE we persist anything. Fails fast with 402
  // if pool is exhausted or per-user/per-role cap hit. We use the snapshot's
  // allocationId on the debit below to keep both halves in lockstep.
  const quota = await requireAvailableQuota({
    tenantId: access.tenantId,
    userId: args.userId,
    surface: AiCallSurface.chat,
  });

  // Persist the user message before the model call so it's never lost on a
  // model failure / network glitch. The assistant reply is appended after.
  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: AiMessageRole.user,
      content: args.content,
    },
  });

  // Build the message history we send to the model: system prompt +
  // last HISTORY_WINDOW_MESSAGES turns (oldest first). The user message we
  // just persisted is included.
  const recent = await prisma.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_WINDOW_MESSAGES,
  });
  const orderedHistory = [...recent].reverse();

  const mappedHistory: ChatMessage[] = orderedHistory.map((m) => {
    const role: 'system' | 'user' | 'assistant' =
      m.role === AiMessageRole.system
        ? 'system'
        : m.role === AiMessageRole.user
          ? 'user'
          : 'assistant';
    return { role, content: m.content };
  });

  const messagesForModel: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...mappedHistory,
  ];

  const callStartedAt = Date.now();
  const result = !access.globallyEnabled
    ? {
        answer: null,
        model: aiConfig().model,
        tokensIn: null,
        tokensOut: null,
        errorReason: 'ai_disabled' as string | null,
      }
    : await callChatModel({
        messages: messagesForModel,
        temperature: CHAT_TEMPERATURE,
        maxTokens: CHAT_MAX_TOKENS,
      });
  const latencyMs = Date.now() - callStartedAt;

  const fallbackUsed = result.answer === null;
  const finalAnswer = result.answer ?? FALLBACK_REPLY;

  const assistantMessage = await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: AiMessageRole.assistant,
      content: finalAnswer,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      model: fallbackUsed ? null : result.model,
      fallbackUsed,
      errorReason: result.errorReason,
    },
  });

  // Bump the conversation's updatedAt so the sidebar re-orders.
  await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Phase 7.4: debit the pool. Always debit, even on fallback — prevents
  // free-retry abuse where a user spams a known-bad prompt to drain the
  // model. Per the risk register in payment.md.
  await debitQuota({
    tenantId: access.tenantId,
    userId: args.userId,
    allocationId: quota.allocationId,
    surface: AiCallSurface.chat,
    reasonRef: assistantMessage.id,
  });

  // Fire-and-forget audit/usage event.
  void recordAiCall({
    tenantId: access.tenantId,
    userId: args.userId,
    surface: AiCallSurface.chat,
    model: fallbackUsed ? null : result.model,
    status: fallbackUsed ? AiCallStatus.fallback : AiCallStatus.success,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs,
    errorReason: result.errorReason,
  });

  // Auto-title generation on the first user→assistant exchange. Don't block
  // on it — runs after we send the response.
  if (!conversation.title && !fallbackUsed) {
    void generateTitleForConversation({
      conversationId: conversation.id,
      tenantId: access.tenantId,
      userId: args.userId,
      firstUserMessage: args.content,
      firstAssistantReply: finalAnswer,
    });
  }

  return {
    assistantMessage: mapMessage(assistantMessage),
  };
}

async function generateTitleForConversation(args: {
  conversationId: string;
  tenantId: string;
  userId: string;
  firstUserMessage: string;
  firstAssistantReply: string;
}): Promise<void> {
  const config = aiConfig();
  if (!config.enabled || !config.apiKey) return;

  // Title generation is best-effort. Skip it silently if the user has hit
  // their quota — the user already got their reply; we don't want to surface
  // a 402 from a background task.
  let allocationId: string;
  try {
    const quota = await requireAvailableQuota({
      tenantId: args.tenantId,
      userId: args.userId,
      surface: AiCallSurface.chat_title,
    });
    allocationId = quota.allocationId;
  } catch {
    return;
  }

  const callStartedAt = Date.now();
  const result = await callChatModel({
    messages: [
      { role: 'system', content: TITLE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `User: ${args.firstUserMessage}\nAssistant: ${args.firstAssistantReply}`,
      },
    ],
    temperature: TITLE_TEMPERATURE,
    maxTokens: TITLE_MAX_TOKENS,
  });
  const latencyMs = Date.now() - callStartedAt;

  if (result.answer) {
    try {
      await prisma.aiConversation.update({
        where: { id: args.conversationId },
        data: { title: result.answer.slice(0, 80) },
      });
    } catch (err) {
      logger.warn({
        msg: 'Failed to persist generated chat title',
        conversationId: args.conversationId,
        err: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // Debit only when the model actually ran successfully — title generation
  // is unique among AI surfaces in NOT debiting on fallback (because it
  // already cost a debit on the parent message; titles are a free side-effect).
  if (result.answer) {
    await debitQuota({
      tenantId: args.tenantId,
      userId: args.userId,
      allocationId,
      surface: AiCallSurface.chat_title,
      reasonRef: `conversation:${args.conversationId}:title`,
    });
  }

  void recordAiCall({
    tenantId: args.tenantId,
    userId: args.userId,
    surface: AiCallSurface.chat_title,
    model: result.answer ? result.model : null,
    status: result.answer ? AiCallStatus.success : AiCallStatus.fallback,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs,
    errorReason: result.errorReason,
  });
}

export async function updateConversation(args: {
  userId: string;
  conversationId: string;
  title?: string | null;
  archived?: boolean;
}) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: { activeTenantId: true },
  });
  if (!user || !user.activeTenantId) {
    throw httpError(403, 'TENANT_REQUIRED', 'An active tenant is required.');
  }
  const conversation = await loadConversationOwned({
    conversationId: args.conversationId,
    userId: args.userId,
    tenantId: user.activeTenantId,
  });

  const data: { title?: string | null; archivedAt?: Date | null } = {};
  if (args.title !== undefined) data.title = args.title;
  if (args.archived !== undefined) {
    data.archivedAt = args.archived ? new Date() : null;
  }

  const updated = await prisma.aiConversation.update({
    where: { id: conversation.id },
    data,
  });
  return mapConversation(updated);
}

export async function deleteConversation(args: {
  userId: string;
  conversationId: string;
}) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: { activeTenantId: true },
  });
  if (!user || !user.activeTenantId) {
    throw httpError(403, 'TENANT_REQUIRED', 'An active tenant is required.');
  }
  const conversation = await loadConversationOwned({
    conversationId: args.conversationId,
    userId: args.userId,
    tenantId: user.activeTenantId,
  });
  await prisma.aiConversation.delete({ where: { id: conversation.id } });
  return { deleted: true };
}
