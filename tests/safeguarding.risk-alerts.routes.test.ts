import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  getYoungPersonChronology,
  getHomeChronology,
  listRiskRules,
  listRiskAlerts,
  getRiskAlert,
  evaluateRiskAlerts,
  acknowledgeRiskAlert,
  markRiskAlertInProgress,
  resolveRiskAlert,
  createRiskAlertNote,
} = vi.hoisted(() => ({
  getYoungPersonChronology: vi.fn(),
  getHomeChronology: vi.fn(),
  listRiskRules: vi.fn(),
  listRiskAlerts: vi.fn(),
  getRiskAlert: vi.fn(),
  evaluateRiskAlerts: vi.fn(),
  acknowledgeRiskAlert: vi.fn(),
  markRiskAlertInProgress: vi.fn(),
  resolveRiskAlert: vi.fn(),
  createRiskAlertNote: vi.fn(),
}));

vi.mock('../src/modules/safeguarding/safeguarding.service.js', () => ({
  getYoungPersonChronology,
  getHomeChronology,
}));

vi.mock('../src/modules/safeguarding/risk-alerts.service.js', () => ({
  listRiskRules,
  listRiskAlerts,
  getRiskAlert,
  evaluateRiskAlerts,
  acknowledgeRiskAlert,
  markRiskAlertInProgress,
  resolveRiskAlert,
  createRiskAlertNote,
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

const mockAlert = {
  id: 'alert_1',
  tenantId: 'tenant_1',
  type: 'repeated_incident_pattern',
  severity: 'high',
  status: 'new',
  targetType: 'young_person',
  targetId: 'yp_1',
  homeId: 'home_1',
  youngPersonId: 'yp_1',
  ruleKey: 'repeated_incident_pattern',
  dedupeKey: 'repeated_incident_pattern:young_person:yp_1',
  title: 'Repeated incident pattern',
  description: '3 incident tasks were logged for this young person in 7 days.',
  evidence: { incidentCount: 3 },
  windowStart: '2026-04-01T00:00:00.000Z',
  windowEnd: '2026-04-03T00:00:00.000Z',
  firstTriggeredAt: '2026-04-03T00:00:00.000Z',
  lastTriggeredAt: '2026-04-03T00:00:00.000Z',
  triggeredCount: 1,
  ownerUserId: null,
  acknowledgedById: null,
  acknowledgedAt: null,
  resolvedById: null,
  resolvedAt: null,
  lastEvaluatedAt: '2026-04-03T00:00:00.000Z',
  createdAt: '2026-04-03T00:00:00.000Z',
  updatedAt: '2026-04-03T00:00:00.000Z',
  notes: [],
  confidentialityScope: 'standard',
};

describe('Safeguarding risk-alert routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/risk-alerts',
    });

    expect(response.statusCode).toBe(401);
  });

  it('lists risk rules', async () => {
    listRiskRules.mockResolvedValueOnce([
      {
        key: 'repeated_incident_pattern',
        name: 'Repeated Incident Pattern',
        description: 'desc',
        defaultSeverity: 'high',
        windowHours: 168,
        threshold: 3,
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/risk-alerts/rules',
      headers: authHeader('manager_1', 'manager', 'sub_admin'),
    });

    expect(response.statusCode).toBe(200);
    expect(listRiskRules).toHaveBeenCalledWith('manager_1');
    expect(response.json()).toMatchObject({ success: true });
  });

  it('lists risk alerts with parsed query', async () => {
    listRiskAlerts.mockResolvedValueOnce({
      data: [mockAlert],
      meta: { total: 1, page: 2, pageSize: 5, totalPages: 1 },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/risk-alerts?page=2&pageSize=5&status=new&includeNotes=true',
      headers: authHeader('admin_1', 'admin', 'tenant_admin'),
    });

    expect(response.statusCode).toBe(200);
    expect(listRiskAlerts).toHaveBeenCalledWith('admin_1', {
      page: 2,
      pageSize: 5,
      status: 'new',
      includeNotes: true,
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: [
        {
          id: 'alert_1',
          status: 'new',
        },
      ],
      meta: { page: 2, pageSize: 5 },
    });
  });

  it('validates evaluate payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/safeguarding/risk-alerts/evaluate',
      headers: authHeader('admin_1', 'admin', 'tenant_admin'),
      payload: { lookbackHours: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(evaluateRiskAlerts).not.toHaveBeenCalled();
  });

  it('acknowledges a risk alert', async () => {
    acknowledgeRiskAlert.mockResolvedValueOnce({
      ...mockAlert,
      status: 'acknowledged',
      ownerUserId: 'owner_1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/safeguarding/risk-alerts/cmmabcd12345678901234567/acknowledge',
      headers: authHeader('admin_2', 'admin', 'tenant_admin'),
      payload: { ownerUserId: 'owner_1', note: 'Taking ownership now.' },
    });

    expect(response.statusCode).toBe(200);
    expect(acknowledgeRiskAlert).toHaveBeenCalledWith(
      'admin_2',
      'cmmabcd12345678901234567',
      {
        ownerUserId: 'owner_1',
        note: 'Taking ownership now.',
        sendEmailHooks: false,
      },
    );
  });
});
