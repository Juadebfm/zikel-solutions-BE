import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  getYoungPersonChronology,
  getHomeChronology,
  getReflectivePromptSet,
  saveReflectivePromptResponses,
} = vi.hoisted(() => ({
  getYoungPersonChronology: vi.fn(),
  getHomeChronology: vi.fn(),
  getReflectivePromptSet: vi.fn(),
  saveReflectivePromptResponses: vi.fn(),
}));

vi.mock('../src/modules/safeguarding/safeguarding.service.js', () => ({
  getYoungPersonChronology,
  getHomeChronology,
  getReflectivePromptSet,
  saveReflectivePromptResponses,
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
  role: 'staff' | 'manager' | 'admin' | 'super_admin' = 'manager',
  tenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null = 'tenant_admin',
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantRole,
  });
  return { authorization: `Bearer ${token}` };
}

const MOCK_RESPONSE = {
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
    eventType: null,
    severity: null,
    source: null,
    confidentialityScope: 'standard',
    maxEvents: 200,
  },
  summary: {
    totalEvents: 3,
    byType: { incident: 1, approval: 1, daily_log: 1 },
    bySeverity: { medium: 2, high: 1 },
    bySource: { tasks: 3 },
    earliestAt: '2026-03-30T09:00:00.000Z',
    latestAt: '2026-04-01T10:00:00.000Z',
  },
  chronology: [],
  narrative: {
    source: 'fallback',
    generatedAt: '2026-04-02T10:00:00.000Z',
    summary: 'Chronology summary',
    keySignals: ['signal'],
    recommendedActions: ['action'],
    evidenceReferences: ['task_1'],
    qualityChecks: {
      version: 'chronology-empathy-v1',
      childCentred: true,
      evidenceGrounded: true,
      nonBlamingLanguage: true,
      passed: true,
    },
  },
};

describe('Safeguarding routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/chronology/young-people/cmmabcd12345678901234567',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns chronology for a young person', async () => {
    getYoungPersonChronology.mockResolvedValueOnce(MOCK_RESPONSE);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/chronology/young-people/cmmabcd12345678901234567?eventType=incident&maxEvents=50',
      headers: authHeader('manager_1', 'manager', 'sub_admin'),
    });

    expect(response.statusCode).toBe(200);
    expect(getYoungPersonChronology).toHaveBeenCalledWith(
      'manager_1',
      'cmmabcd12345678901234567',
      {
        eventType: 'incident',
        maxEvents: 50,
        includeNarrative: true,
      },
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        targetType: 'young_person',
      },
    });
  });

  it('rejects invalid query shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/chronology/homes/cmmabcd12345678901234567?dateFrom=2026-04-02&dateTo=2026-04-01',
      headers: authHeader('admin_1', 'admin'),
    });

    expect(response.statusCode).toBe(422);
    expect(getHomeChronology).not.toHaveBeenCalled();
  });

  it('passes includeNarrative=false to home chronology service', async () => {
    getHomeChronology.mockResolvedValueOnce({
      ...MOCK_RESPONSE,
      targetType: 'home',
      target: {
        id: 'home_1',
        name: 'Northbridge Home',
        homeId: 'home_1',
        homeName: 'Northbridge Home',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/chronology/homes/cmmabcd12345678901234567?includeNarrative=false&source=tasks',
      headers: authHeader('admin_2', 'admin'),
    });

    expect(response.statusCode).toBe(200);
    expect(getHomeChronology).toHaveBeenCalledWith(
      'admin_2',
      'cmmabcd12345678901234567',
      {
        includeNarrative: false,
        source: 'tasks',
        maxEvents: 200,
      },
    );
  });

  it('returns reflective prompts by task context', async () => {
    getReflectivePromptSet.mockResolvedValueOnce({
      promptSet: {
        key: 'reflective:incident:medication:medication_safety',
        version: 'v1',
        rollout: { enabled: true, mode: 'all', reason: null },
        context: {
          taskId: 'cmmabcd12345678901234567',
          formTemplateKey: 'incident_form',
          formGroup: 'incident',
          contextCategory: 'incident',
          incidentType: 'medication',
          childProfile: 'standard',
          safeguardingClass: 'medication_safety',
        },
        prompts: [
          {
            id: 'communication_signal',
            text: 'What might the child have been communicating?',
            category: 'mandatory',
            mandatory: true,
            order: 1,
            version: 'v1',
            tags: ['mandatory'],
          },
        ],
        mandatoryPromptIds: ['communication_signal'],
        guidance: ['Use non-blaming language.'],
        generatedAt: '2026-04-03T10:00:00.000Z',
      },
      existingResponses: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/safeguarding/reflective-prompts?taskId=cmmabcd12345678901234567',
      headers: authHeader('manager_3', 'manager'),
    });

    expect(response.statusCode).toBe(200);
    expect(getReflectivePromptSet).toHaveBeenCalledWith('manager_3', {
      taskId: 'cmmabcd12345678901234567',
      includeOptional: true,
    });
  });

  it('saves reflective prompt responses for a task', async () => {
    saveReflectivePromptResponses.mockResolvedValueOnce({
      taskId: 'cmmabcd12345678901234567',
      savedAt: '2026-04-03T10:10:00.000Z',
      reflectivePrompts: {
        version: 'v1',
        promptSetKey: 'reflective:incident:medication:medication_safety',
        source: 'manual',
        context: {
          taskId: 'cmmabcd12345678901234567',
          formTemplateKey: 'incident_form',
          formGroup: 'incident',
          contextCategory: 'incident',
          incidentType: 'medication',
          childProfile: 'standard',
          safeguardingClass: 'medication_safety',
        },
        responses: [
          {
            promptId: 'communication_signal',
            promptText: 'What might the child have been communicating?',
            response: 'The child appeared anxious about side effects.',
            category: 'mandatory',
            mandatory: true,
            answeredAt: '2026-04-03T10:10:00.000Z',
          },
        ],
        mandatoryPromptIds: ['communication_signal'],
        mandatoryAnsweredCount: 1,
        totalResponses: 1,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/safeguarding/reflective-prompts/tasks/cmmabcd12345678901234567/responses',
      headers: authHeader('admin_3', 'admin', null),
      payload: {
        source: 'manual',
        responses: [
          {
            promptId: 'communication_signal',
            response: 'The child appeared anxious about side effects.',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(saveReflectivePromptResponses).toHaveBeenCalledWith(
      'admin_3',
      'cmmabcd12345678901234567',
      {
        source: 'manual',
        responses: [
          {
            promptId: 'communication_signal',
            response: 'The child appeared anxious about side effects.',
          },
        ],
      },
    );
  });
});
