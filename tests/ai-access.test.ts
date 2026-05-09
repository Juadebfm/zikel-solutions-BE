/**
 * Phase 8.1 — coverage for the shared AI access gate.
 *
 * `assertAiEnabledForRequest` is the single source of truth used by every
 * AI call site (chat, dashboard cards, chronology narrative). These tests
 * lock in the four-condition gate:
 *   1. Server-level (AI_ENABLED) — silent fallback, never throws
 *   2. Tenant exists / is active
 *   3. Tenant.aiEnabled
 *   4. TenantUser.aiAccessEnabled
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: { findUnique: vi.fn() },
    aiCallEvent: { create: vi.fn(async () => ({ id: 'evt_1' })) },
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
// Default AI_ENABLED on for these tests; individual tests flip it via env mutation.
process.env.AI_ENABLED = 'true';
process.env.AI_API_KEY = 'sk-test-xxxx';

let assertAiEnabledForRequest: typeof import('../src/lib/ai-access.js').assertAiEnabledForRequest;
let recordAiCall: typeof import('../src/lib/ai-access.js').recordAiCall;

beforeAll(async () => {
  // Import after env vars are set so envSchema parses cleanly.
  const mod = await import('../src/lib/ai-access.js');
  assertAiEnabledForRequest = mod.assertAiEnabledForRequest;
  recordAiCall = mod.recordAiCall;
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // No global state to reset
});

const baseTenant = {
  id: 't_1',
  aiEnabled: true,
  isActive: true,
};

const baseUser = {
  id: 'u_1',
  aiAccessEnabled: true,
  activeTenantId: 't_1',
  activeTenant: baseTenant,
};

describe('assertAiEnabledForRequest — happy path', () => {
  it('returns globallyEnabled=true and the tenantId when all gates pass', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(baseUser);
    const result = await assertAiEnabledForRequest({ userId: 'u_1', surface: 'chat' });
    expect(result).toEqual({ globallyEnabled: true, tenantId: 't_1' });
  });
});

describe('assertAiEnabledForRequest — denial paths', () => {
  it('throws 404 USER_NOT_FOUND when the user does not exist', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue(null);
    await expect(
      assertAiEnabledForRequest({ userId: 'u_missing', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
  });

  it('throws 403 TENANT_REQUIRED when the user has no active tenant', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      ...baseUser,
      activeTenantId: null,
      activeTenant: null,
    });
    await expect(
      assertAiEnabledForRequest({ userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_REQUIRED' });
  });

  it('throws 403 TENANT_INACTIVE when the active tenant is inactive', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      ...baseUser,
      activeTenant: { ...baseTenant, isActive: false },
    });
    await expect(
      assertAiEnabledForRequest({ userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_INACTIVE' });
  });

  it('throws 403 AI_DISABLED_FOR_TENANT when Tenant.aiEnabled is false', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      ...baseUser,
      activeTenant: { ...baseTenant, aiEnabled: false },
    });
    await expect(
      assertAiEnabledForRequest({ userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AI_DISABLED_FOR_TENANT' });
  });

  it('throws 403 AI_ACCESS_DISABLED when TenantUser.aiAccessEnabled is false', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      ...baseUser,
      aiAccessEnabled: false,
    });
    await expect(
      assertAiEnabledForRequest({ userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AI_ACCESS_DISABLED' });
  });
});

describe('recordAiCall', () => {
  it('writes a row with all fields populated', async () => {
    await recordAiCall({
      tenantId: 't_1',
      userId: 'u_1',
      surface: 'chat',
      model: 'gpt-4o-mini',
      status: 'success',
      tokensIn: 123,
      tokensOut: 45,
      latencyMs: 250,
      errorReason: null,
    });
    expect(mockPrisma.aiCallEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        userId: 'u_1',
        surface: 'chat',
        model: 'gpt-4o-mini',
        status: 'success',
        tokensIn: 123,
        tokensOut: 45,
        latencyMs: 250,
        errorReason: null,
      }),
    });
  });

  it('coerces undefined optional fields to null', async () => {
    await recordAiCall({
      tenantId: 't_1',
      userId: 'u_1',
      surface: 'chronology_narrative',
      model: null,
      status: 'fallback',
    });
    expect(mockPrisma.aiCallEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        model: null,
        status: 'fallback',
        tokensIn: null,
        tokensOut: null,
        latencyMs: null,
        errorReason: null,
      }),
    });
  });

  it('swallows errors silently — never throws upstream', async () => {
    mockPrisma.aiCallEvent.create.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(
      recordAiCall({
        tenantId: 't_1',
        userId: 'u_1',
        surface: 'chat',
        model: null,
        status: 'error',
      }),
    ).resolves.toBeUndefined();
  });
});
