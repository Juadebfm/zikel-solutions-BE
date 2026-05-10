/**
 * Phase 8.2 — coverage for conversational AI.
 *
 * Locks in:
 *   - Create / list / get / update / delete each respect tenant + user scope
 *   - postMessage persists user message FIRST, then attempts model, falls
 *     back gracefully on failure (user message is never lost)
 *   - Multi-turn history threading (3-turn dialogue → 3rd model call sees
 *     all prior messages)
 *   - Auto-title fires after first successful exchange (only when title
 *     was null and the call succeeded)
 *   - Quota debit on every message + title generation (via AiCallEvent)
 *   - Tenant isolation: user A cannot read user B's conversations
 *   - Archived conversations cannot accept new messages
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
  process.env.AI_ENABLED = 'true';
  process.env.AI_API_KEY = 'sk-test';
  process.env.AI_MODEL = 'gpt-4o-mini';
  process.env.AI_BASE_URL = 'https://example.test/v1';
});

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    tenantUser: { findUnique: vi.fn() },
    aiConversation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    aiMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    aiCallEvent: { create: vi.fn(async () => ({ id: 'evt_1' })) },
    // Phase 7.4 — token-metering tables
    subscription: { findUnique: vi.fn(async () => null) },
    tenant: { findUnique: vi.fn(async () => ({ createdAt: new Date('2026-04-01') })) },
    tokenAllocation: {
      upsert: vi.fn(async () => ({
        id: 'alloc_1',
        bundledCalls: 1000,
        topUpCalls: 0,
        usedCalls: 0,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        resetAt: new Date('2026-06-01'),
      })),
      update: vi.fn(async () => ({})),
    },
    tokenLedgerEntry: {
      create: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { delta: 0 } })),
    },
    tenantAiRestriction: { findUnique: vi.fn(async () => null) },
    tenantMembership: { findFirst: vi.fn(async () => ({ role: { name: 'Owner' } })) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') {
        return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      }
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  return { mockPrisma: mp };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

let service: typeof import('../src/modules/ai/conversations.service.js');
let originalFetch: typeof fetch;

beforeAll(async () => {
  service = await import('../src/modules/ai/conversations.service.js');
  originalFetch = global.fetch;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const baseAccessUser = {
  id: 'user_1',
  aiAccessEnabled: true,
  activeTenantId: 'tenant_1',
  activeTenant: { id: 'tenant_1', aiEnabled: true, isActive: true },
};

function mockOpenAiOk(args: {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
}) {
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: args.content } }],
        usage: {
          prompt_tokens: args.promptTokens ?? 100,
          completion_tokens: args.completionTokens ?? 50,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as typeof fetch;
}

function mockOpenAiFail() {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify({}), { status: 503 }),
  ) as typeof fetch;
}

describe('createConversation', () => {
  it('creates a conversation scoped to the user + tenant', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.create.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: null,
      archivedAt: null,
      createdAt: new Date('2026-05-09'),
      updatedAt: new Date('2026-05-09'),
    });
    const result = await service.createConversation({ userId: 'user_1' });
    expect(result.id).toBe('conv_1');
    expect(mockPrisma.aiConversation.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant_1', userId: 'user_1' },
    });
  });
});

describe('listConversations', () => {
  it('only returns rows scoped to the calling user + tenant', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      activeTenantId: 'tenant_1',
    });
    mockPrisma.aiConversation.count.mockResolvedValue(2);
    mockPrisma.aiConversation.findMany.mockResolvedValue([
      { id: 'a', title: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'b', title: 'Hello', archivedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const result = await service.listConversations({
      userId: 'user_1',
      page: 1,
      pageSize: 20,
      includeArchived: false,
    });
    expect(result.data).toHaveLength(2);
    expect(mockPrisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant_1', userId: 'user_1', archivedAt: null },
      }),
    );
  });

  it('includes archived when explicitly requested', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      activeTenantId: 'tenant_1',
    });
    mockPrisma.aiConversation.count.mockResolvedValue(0);
    mockPrisma.aiConversation.findMany.mockResolvedValue([]);
    await service.listConversations({
      userId: 'user_1',
      page: 1,
      pageSize: 20,
      includeArchived: true,
    });
    expect(mockPrisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant_1', userId: 'user_1' },
      }),
    );
  });
});

describe('getConversation', () => {
  it('returns 404 when the conversation belongs to a different user', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({ activeTenantId: 'tenant_1' });
    mockPrisma.aiConversation.findFirst.mockResolvedValue(null);
    await expect(
      service.getConversation({ userId: 'user_1', conversationId: 'conv_other' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
  });
});

describe('postMessage — happy path', () => {
  it('persists user message, calls model, persists assistant reply, debits AiCallEvent', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: 'Existing title',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiMessage.create
      .mockResolvedValueOnce({ id: 'msg_user', role: 'user', content: 'Hi' })
      .mockResolvedValueOnce({
        id: 'msg_asst',
        role: 'assistant',
        content: 'Hello!',
        fallbackUsed: false,
        createdAt: new Date(),
      });
    mockPrisma.aiMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'Hi' },
    ]);
    mockPrisma.aiConversation.update.mockResolvedValue({});
    mockOpenAiOk({ content: 'Hello!', promptTokens: 50, completionTokens: 10 });

    const result = await service.postMessage({
      userId: 'user_1',
      conversationId: 'conv_1',
      content: 'Hi',
    });

    expect(result.assistantMessage.content).toBe('Hello!');
    expect(result.assistantMessage.fallbackUsed).toBe(false);

    // User message persisted FIRST (call 1) — assistant reply second (call 2)
    expect(mockPrisma.aiMessage.create.mock.calls[0]?.[0]?.data).toMatchObject({
      role: 'user',
      content: 'Hi',
    });
    expect(mockPrisma.aiMessage.create.mock.calls[1]?.[0]?.data).toMatchObject({
      role: 'assistant',
      content: 'Hello!',
      fallbackUsed: false,
      tokensIn: 50,
      tokensOut: 10,
    });

    // updatedAt bumped
    expect(mockPrisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { updatedAt: expect.any(Date) },
    });

    // AiCallEvent recorded
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.aiCallEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant_1',
        userId: 'user_1',
        surface: 'chat',
        status: 'success',
        tokensIn: 50,
        tokensOut: 10,
      }),
    });
  });
});

describe('postMessage — fallback path', () => {
  it('persists assistant message with fallbackUsed=true when the provider fails', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: 'x',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiMessage.create
      .mockResolvedValueOnce({ id: 'm1' })
      .mockResolvedValueOnce({
        id: 'm2',
        role: 'assistant',
        content: 'I am not available right now — please try again in a moment. If this keeps happening, contact your administrator.',
        fallbackUsed: true,
        createdAt: new Date(),
      });
    mockPrisma.aiMessage.findMany.mockResolvedValue([{ role: 'user', content: 'x' }]);
    mockPrisma.aiConversation.update.mockResolvedValue({});
    mockOpenAiFail();

    const result = await service.postMessage({
      userId: 'user_1',
      conversationId: 'conv_1',
      content: 'x',
    });
    expect(result.assistantMessage.fallbackUsed).toBe(true);

    // Assistant call wrote fallbackUsed=true
    expect(mockPrisma.aiMessage.create.mock.calls[1]?.[0]?.data).toMatchObject({
      fallbackUsed: true,
      role: 'assistant',
    });

    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.aiCallEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'fallback',
        errorReason: expect.stringMatching(/provider_status_503|unknown/),
      }),
    });
  });

  it('refuses to post to an archived conversation', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: 'old',
      archivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      service.postMessage({ userId: 'user_1', conversationId: 'conv_1', content: 'x' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONVERSATION_ARCHIVED' });
  });
});

describe('postMessage — auto-title generation', () => {
  it('fires title generation only when title is null and reply succeeded', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_new',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: null, // ← null triggers title generation
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiMessage.create
      .mockResolvedValueOnce({ id: 'mu' })
      .mockResolvedValueOnce({
        id: 'ma',
        role: 'assistant',
        content: 'Sure I can help with rota planning.',
        fallbackUsed: false,
        createdAt: new Date(),
      });
    mockPrisma.aiMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'Help me with rotas' },
    ]);
    mockPrisma.aiConversation.update.mockResolvedValue({});

    // First fetch = main reply (success), second fetch = title generation
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount += 1;
      const reply = callCount === 1 ? 'Sure I can help with rota planning.' : 'Rota planning help';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: reply } }],
          usage: { prompt_tokens: 50, completion_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    await service.postMessage({
      userId: 'user_1',
      conversationId: 'conv_new',
      content: 'Help me with rotas',
    });
    // Title generation is fire-and-forget — wait one tick.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(callCount).toBeGreaterThanOrEqual(2);
    // Title was persisted via aiConversation.update with the title field
    const titleUpdates = mockPrisma.aiConversation.update.mock.calls.filter(
      (c: unknown[]) =>
        Boolean((c[0] as { data: { title?: string } } | undefined)?.data?.title),
    );
    expect(titleUpdates.length).toBeGreaterThanOrEqual(1);

    // chat_title surface was recorded
    const titleCallEvents = mockPrisma.aiCallEvent.create.mock.calls.filter(
      (c: unknown[]) =>
        ((c[0] as { data: { surface: string } } | undefined)?.data?.surface) === 'chat_title',
    );
    expect(titleCallEvents.length).toBe(1);
  });

  it('does NOT fire title generation when reply fell back', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_x',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiMessage.create
      .mockResolvedValueOnce({ id: 'mu' })
      .mockResolvedValueOnce({ id: 'ma', role: 'assistant', content: 'fallback', fallbackUsed: true, createdAt: new Date() });
    mockPrisma.aiMessage.findMany.mockResolvedValue([{ role: 'user', content: 'x' }]);
    mockPrisma.aiConversation.update.mockResolvedValue({});
    mockOpenAiFail();

    await service.postMessage({ userId: 'user_1', conversationId: 'conv_x', content: 'x' });
    await new Promise((r) => setImmediate(r));

    const titleCallEvents = mockPrisma.aiCallEvent.create.mock.calls.filter(
      (c: unknown[]) =>
        ((c[0] as { data: { surface: string } } | undefined)?.data?.surface) === 'chat_title',
    );
    expect(titleCallEvents.length).toBe(0);
  });
});

describe('multi-turn history threading', () => {
  it('sends prior messages (oldest-first) to the model on each turn', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseAccessUser);
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: 'x',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiMessage.create
      .mockResolvedValueOnce({ id: 'mu' })
      .mockResolvedValueOnce({ id: 'ma', role: 'assistant', content: 'reply', fallbackUsed: false, createdAt: new Date() });
    // findMany returns NEWEST-first (per service logic which then reverses).
    // Service reverses → model sees oldest-first.
    mockPrisma.aiMessage.findMany.mockResolvedValue([
      { role: 'user', content: 'turn 3 user' }, // newest (just persisted)
      { role: 'assistant', content: 'turn 2 reply' },
      { role: 'user', content: 'turn 2 user' },
      { role: 'assistant', content: 'turn 1 reply' },
      { role: 'user', content: 'turn 1 user' },
    ]);
    mockPrisma.aiConversation.update.mockResolvedValue({});
    let capturedBody: { messages: Array<{ role: string; content: string }> } | null = null;
    global.fetch = vi.fn(async (_url: unknown, init: { body: string } | undefined) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'reply' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await service.postMessage({
      userId: 'user_1',
      conversationId: 'conv_1',
      content: 'turn 3 user',
    });

    expect(capturedBody).not.toBeNull();
    const messages = capturedBody!.messages;
    // System prompt first
    expect(messages[0]?.role).toBe('system');
    // Oldest user message is the second item (after system)
    expect(messages[1]).toEqual({ role: 'user', content: 'turn 1 user' });
    // Newest user message is last
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'turn 3 user' });
  });
});

describe('updateConversation', () => {
  it('renames a conversation', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({ activeTenantId: 'tenant_1' });
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: 'old',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiConversation.update.mockResolvedValue({
      id: 'conv_1',
      title: 'New title',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await service.updateConversation({
      userId: 'user_1',
      conversationId: 'conv_1',
      title: 'New title',
    });
    expect(result.title).toBe('New title');
    expect(mockPrisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { title: 'New title' },
    });
  });

  it('archives a conversation by setting archivedAt', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({ activeTenantId: 'tenant_1' });
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiConversation.update.mockResolvedValue({
      id: 'conv_1',
      title: null,
      archivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await service.updateConversation({
      userId: 'user_1',
      conversationId: 'conv_1',
      archived: true,
    });
    expect(mockPrisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe('deleteConversation', () => {
  it('hard-deletes a conversation owned by the user', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({ activeTenantId: 'tenant_1' });
    mockPrisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      title: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.aiConversation.delete.mockResolvedValue({ id: 'conv_1' });
    const result = await service.deleteConversation({
      userId: 'user_1',
      conversationId: 'conv_1',
    });
    expect(result).toEqual({ deleted: true });
    expect(mockPrisma.aiConversation.delete).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
    });
  });
});
