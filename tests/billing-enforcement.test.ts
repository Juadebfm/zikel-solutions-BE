/**
 * Phase 7.7 — billing enforcement matrix.
 *
 * Locks in the locked decision (payment.md C):
 *
 *   trialing            → all access
 *   active              → all access
 *   past_due_grace      → all access (banner only — middleware bypass)
 *   past_due_readonly   → mutations + AI + exports → 402
 *   incomplete          → mutations + AI + exports → 402
 *
 * GETs always pass through. Subscription unknown → permissive (defensive).
 * Manual override (support escalation) bypasses everything until expiry.
 * Impersonation tokens (platform staff debugging) bypass everything.
 *
 * Also covers the past-due transition cron's day-windowing logic.
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
});

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    subscription: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    tenant: { update: vi.fn(async () => ({})) },
    billingEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  return { mockPrisma: mp };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
// suspendTenant has its own DB calls + email side-effects. Stub it for the
// past-due cron test so we only assert the middleware/cron behaviour, not
// the suspend chain (which has its own coverage in tenants.routes.test.ts).
vi.mock('../src/modules/admin/admin-tenants.service.js', () => ({
  suspendTenant: vi.fn(async () => ({ id: 't_1', isActive: false })),
}));

let middleware: typeof import('../src/middleware/billing-status.js');
let pastDue: typeof import('../src/modules/billing/past-due.scheduler.js');

beforeAll(async () => {
  middleware = await import('../src/middleware/billing-status.js');
  pastDue = await import('../src/modules/billing/past-due.scheduler.js');
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // No global state.
});

// ─── Test harness — synthetic fastify request/reply ─────────────────────────

interface FakeRequest {
  user?: { sub: string; tenantId?: string; impersonatorId?: string } | undefined;
  method: string;
  // billing-status uses a Symbol for caching — leave as a flat object.
}

interface FakeReply {
  statusCode: number | null;
  body: { code: string; message: string } | null;
  status(code: number): this;
  send(payload: { error?: { code: string; message: string } }): this;
}

function makeRequest(args: {
  method?: string;
  tenantId?: string | null;
  user?: 'present' | 'absent' | 'impersonator';
}): FakeRequest {
  const method = args.method ?? 'POST';
  if (args.user === 'absent') return { method } as FakeRequest;
  if (args.user === 'impersonator') {
    return {
      method,
      user: { sub: 'u_1', tenantId: args.tenantId ?? 't_1', impersonatorId: 'p_admin_1' },
    };
  }
  return { method, user: { sub: 'u_1', tenantId: args.tenantId ?? 't_1' } };
}

function makeReply(): FakeReply {
  return {
    statusCode: null,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: { error?: { code: string; message: string } }) {
      this.body = payload.error ?? null;
      return this;
    },
  };
}

// ─── Status matrix ──────────────────────────────────────────────────────────

describe('requireActiveSubscription — status matrix', () => {
  it.each([
    ['trialing', false],
    ['active', false],
    ['past_due_grace', false],
    ['past_due_readonly', true],
    ['incomplete', true],
  ])('status=%s → %s on POST', async (status, shouldBlock) => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status,
      manuallyOverriddenUntil: null,
    });
    const req = makeRequest({ method: 'POST' });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(req as any, reply as any);
    if (shouldBlock) {
      expect(reply.statusCode).toBe(402);
    } else {
      expect(reply.statusCode).toBeNull();
    }
  });
});

describe('requireActiveSubscription — verb gating', () => {
  it.each(['GET', 'HEAD'])('passes through %s requests regardless of status', async (method) => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'past_due_readonly',
      manuallyOverriddenUntil: null,
    });
    const req = makeRequest({ method });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(req as any, reply as any);
    expect(reply.statusCode).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s when subscription is past_due_readonly',
    async (method) => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        status: 'past_due_readonly',
        manuallyOverriddenUntil: null,
      });
      const req = makeRequest({ method });
      const reply = makeReply();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await middleware.requireActiveSubscription(req as any, reply as any);
      expect(reply.statusCode).toBe(402);
      expect(reply.body?.code).toBe('SUBSCRIPTION_PAST_DUE');
    },
  );
});

describe('requireActiveSubscription — error codes', () => {
  it('past_due_readonly → 402 SUBSCRIPTION_PAST_DUE', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'past_due_readonly',
      manuallyOverriddenUntil: null,
    });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.body).toEqual(
      expect.objectContaining({ code: 'SUBSCRIPTION_PAST_DUE' }),
    );
  });

  it('incomplete → 402 SUBSCRIPTION_INCOMPLETE', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'incomplete',
      manuallyOverriddenUntil: null,
    });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.body).toEqual(
      expect.objectContaining({ code: 'SUBSCRIPTION_INCOMPLETE' }),
    );
  });
});

describe('requireActiveSubscription — special cases', () => {
  it('returns 401 when no user is on the request', async () => {
    const reply = makeReply();
    await middleware.requireActiveSubscription(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ user: 'absent' }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reply as any,
    );
    expect(reply.statusCode).toBe(401);
    expect(reply.body?.code).toBe('UNAUTHENTICATED');
  });

  it('impersonation tokens bypass enforcement entirely', async () => {
    // Even with past_due_readonly status, the impersonator token gets through.
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'past_due_readonly',
      manuallyOverriddenUntil: null,
    });
    const reply = makeReply();
    await middleware.requireActiveSubscription(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ user: 'impersonator' }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reply as any,
    );
    expect(reply.statusCode).toBeNull();
    // Don't even hit the DB — impersonators short-circuit before the lookup.
    expect(mockPrisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('manuallyOverriddenUntil in the future bypasses enforcement', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000); // +1h
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'past_due_readonly',
      manuallyOverriddenUntil: future,
    });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.statusCode).toBeNull();
  });

  it('manuallyOverriddenUntil in the past does NOT bypass enforcement', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000); // -1h
    mockPrisma.subscription.findUnique.mockResolvedValue({
      status: 'past_due_readonly',
      manuallyOverriddenUntil: past,
    });
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.statusCode).toBe(402);
  });

  it('no Subscription row → permissive (treats as transitional)', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.statusCode).toBeNull();
  });

  it('Prisma error → permissive (defensive)', async () => {
    mockPrisma.subscription.findUnique.mockRejectedValueOnce(new Error('DB unavailable'));
    const reply = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware.requireActiveSubscription(makeRequest({}) as any, reply as any);
    expect(reply.statusCode).toBeNull();
  });
});

// ─── Past-due transition cron ───────────────────────────────────────────────

describe('runPastDueTransitionPass', () => {
  it('promotes past_due_grace → past_due_readonly after 3 days', async () => {
    const now = new Date('2026-05-09T00:00:00Z');
    const pastDueSince = new Date('2026-05-05T00:00:00Z'); // 4 days ago
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 't_1', status: 'past_due_grace', pastDueSince },
    ]);
    const result = await pastDue.runPastDueTransitionPass(now);
    expect(result).toEqual({ scanned: 1, transitioned: 1, suspended: 0 });
    // Subscription + Tenant + BillingEvent all updated in one transaction
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { tenantId: 't_1' },
      data: { status: 'past_due_readonly' },
    });
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { subscriptionStatus: 'past_due_readonly' },
    });
    expect(mockPrisma.billingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't_1',
          kind: 'subscription_updated',
          payload: expect.objectContaining({
            source: 'past_due_cron',
            from: 'past_due_grace',
            to: 'past_due_readonly',
          }),
        }),
      }),
    );
  });

  it('promotes past_due_readonly → suspended after 14 days + invokes Phase 6 suspend', async () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const pastDueSince = new Date('2026-05-09T00:00:00Z'); // 21 days ago
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 't_1', status: 'past_due_readonly', pastDueSince },
    ]);

    const adminTenants = await import('../src/modules/admin/admin-tenants.service.js');
    const result = await pastDue.runPastDueTransitionPass(now);

    expect(result).toEqual({ scanned: 1, transitioned: 1, suspended: 1 });
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { tenantId: 't_1' },
      data: { status: 'suspended' },
    });
    // Phase 6 suspend invoked with system actor.
    expect(adminTenants.suspendTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        platformUserId: 'system_past_due_cron',
        tenantId: 't_1',
        reason: expect.stringMatching(/past due > 14 days/),
      }),
    );
  });

  it('skips no-op transitions (status already correct)', async () => {
    const now = new Date('2026-05-09T00:00:00Z');
    const pastDueSince = new Date('2026-05-08T00:00:00Z'); // 1 day ago — still in grace
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 't_1', status: 'past_due_grace', pastDueSince },
    ]);
    const result = await pastDue.runPastDueTransitionPass(now);
    expect(result).toEqual({ scanned: 1, transitioned: 0, suspended: 0 });
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  it('continues processing other tenants when one transition fails', async () => {
    const now = new Date('2026-05-09T00:00:00Z');
    const pastDueSince = new Date('2026-05-05T00:00:00Z');
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 't_fail', status: 'past_due_grace', pastDueSince },
      { tenantId: 't_ok', status: 'past_due_grace', pastDueSince },
    ]);
    // First $transaction call rejects, second succeeds.
    mockPrisma.$transaction
      .mockImplementationOnce(async () => {
        throw new Error('DB blip');
      })
      .mockImplementationOnce(async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops;
      });

    const result = await pastDue.runPastDueTransitionPass(now);
    expect(result.scanned).toBe(2);
    expect(result.transitioned).toBe(1);
  });
});
