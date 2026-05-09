import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { getYoungPersonIncidentPatterns, getHomeIncidentPatterns } = vi.hoisted(() => ({
  getYoungPersonIncidentPatterns: vi.fn(),
  getHomeIncidentPatterns: vi.fn(),
}));

vi.mock('../src/modules/safeguarding/patterns.service.js', () => ({
  getYoungPersonIncidentPatterns,
  getHomeIncidentPatterns,
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function authHeader(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' = 'manager',
  tenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null = 'tenant_admin',
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole,
    mfaVerified: true,
    aud: 'tenant',
  });
  return { authorization: `Bearer ${token}` };
}

const mockPatternsResponse = {
  targetType: 'young_person',
  target: {
    id: 'yp_1',
    name: 'Ava Morris',
    homeId: 'home_1',
    homeName: 'Northbridge Home',
  },
  window: {
    dateFrom: '2026-03-01T00:00:00.000Z',
    dateTo: '2026-04-01T23:59:59.999Z',
    timezone: 'UTC',
  },
  retention: {
    policyDays: 365,
    effectiveDateFrom: '2026-03-01T00:00:00.000Z',
    effectiveDateTo: '2026-04-01T23:59:59.999Z',
  },
  confidentiality: {
    requestedScope: 'standard',
    effectiveScope: 'standard',
  },
  filtersApplied: {
    confidentialityScope: 'standard',
    maxIncidents: 500,
    minOccurrences: 3,
    confidenceThreshold: 0.55,
    maxPatterns: 20,
  },
  summary: {
    totalIncidents: 6,
    flaggedPatterns: 4,
    highConfidencePatterns: 2,
    latestIncidentAt: '2026-04-01T18:10:00.000Z',
    uniqueTriggerTags: 7,
  },
  normalizedIncidents: [],
  patterns: {
    frequency: [],
    clusters: [],
    recurrence: [],
    coOccurrence: [],
  },
  insights: {
    patternInsightSummaries: ['No dominant recurrence pattern detected in this period.'],
    exploreNext: [
      {
        label: 'Expand observation window',
        reason: 'A broader date range may reveal slower-moving patterns.',
        action: 'explore_patterns_expand_window',
      },
    ],
  },
};

describe('Safeguarding pattern routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/patterns/homes/cmmabcd12345678901234567',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns young person patterns with parsed query values', async () => {
    getYoungPersonIncidentPatterns.mockResolvedValueOnce(mockPatternsResponse);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/patterns/young-people/cmmabcd12345678901234567?minOccurrences=4&confidenceThreshold=0.6&maxPatterns=10',
      headers: authHeader('manager_1', 'manager', 'sub_admin'),
    });

    expect(response.statusCode).toBe(200);
    expect(getYoungPersonIncidentPatterns).toHaveBeenCalledWith(
      'manager_1',
      'cmmabcd12345678901234567',
      {
        minOccurrences: 4,
        confidenceThreshold: 0.6,
        maxPatterns: 10,
        maxIncidents: 500,
      },
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        targetType: 'young_person',
      },
    });
  });

  it('rejects invalid query range', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/patterns/homes/cmmabcd12345678901234567?dateFrom=2026-04-03&dateTo=2026-04-01',
      headers: authHeader('admin_1', 'admin', 'tenant_admin'),
    });

    expect(response.statusCode).toBe(422);
    expect(getHomeIncidentPatterns).not.toHaveBeenCalled();
  });
});
