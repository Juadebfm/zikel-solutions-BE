import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 8.1: ai-access.ts (transitive import) loads env.js at module init.
vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
});

const { mockPrisma, requireTenantContext } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    tenantUser: { findUnique: vi.fn() },
    employee: { findFirst: vi.fn() },
    youngPerson: { findFirst: vi.fn() },
    home: { findFirst: vi.fn() },
    task: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    homeEvent: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    aiCallEvent: { create: vi.fn(async () => ({ id: 'evt_1' })) },
  },
  requireTenantContext: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));

import * as safeguardingService from '../src/modules/safeguarding/safeguarding.service.js';

const d = (iso: string) => new Date(iso);

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    title: 'General task',
    description: 'Task details',
    category: 'document',
    status: 'pending',
    approvalStatus: 'not_required',
    priority: 'medium',
    dueDate: null,
    approvedAt: null,
    submittedAt: null,
    createdAt: d('2026-04-01T09:00:00.000Z'),
    updatedAt: d('2026-04-01T09:00:00.000Z'),
    home: { id: 'home_1', name: 'Northbridge Home' },
    youngPerson: { id: 'yp_1', firstName: 'Ava', lastName: 'Morris' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  requireTenantContext.mockResolvedValue({
    tenantId: 'tenant_1',
    userRole: 'admin',
    tenantRole: 'tenant_admin',
  });
  mockPrisma.user.findUnique.mockResolvedValue({
    id: 'user_1',
    role: 'admin',
  });
  // Phase 1 split: services that resolved the actor via `prisma.user` now
  // use `prisma.tenantUser`. Mirror the same fixture so unrelated tests pass.
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: 'user_1',
    role: 'admin',
  });
  mockPrisma.employee.findFirst.mockResolvedValue({ id: 'employee_1' });
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  process.env.AI_ENABLED = 'false';
  process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_ENABLED = 'true';
  process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_ROLLOUT_MODE = 'all';
  process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_VERSION = 'v1';
  process.env.SAFEGUARDING_REFLECTIVE_PROMPTS_WRITE_ENABLED = 'true';
  process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE = 'standard';
  process.env.SAFEGUARDING_CHRONOLOGY_RETENTION_DAYS = '365';
});

describe('safeguarding.service', () => {
  it('builds a deduped, ordered chronology with evidence refs for a young person', async () => {
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce({
      id: 'yp_1',
      firstName: 'Ava',
      lastName: 'Morris',
      homeId: 'home_1',
      home: { id: 'home_1', name: 'Northbridge Home' },
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeTask({
        id: 'task_incident',
        title: 'Incident: medication refusal',
        category: 'incident',
        priority: 'high',
        createdAt: d('2026-04-01T10:00:00.000Z'),
        updatedAt: d('2026-04-01T10:00:00.000Z'),
      }),
      makeTask({
        id: 'task_daily',
        title: 'Daily log entry',
        category: 'daily_log',
        approvalStatus: 'approved',
        createdAt: d('2026-04-01T08:00:00.000Z'),
        updatedAt: d('2026-04-01T08:00:00.000Z'),
      }),
      makeTask({
        id: 'task_approval',
        title: 'PRN medication sign-off',
        category: 'checklist',
        approvalStatus: 'rejected',
        approvedAt: d('2026-04-01T11:00:00.000Z'),
        createdAt: d('2026-04-01T09:00:00.000Z'),
        updatedAt: d('2026-04-01T09:00:00.000Z'),
      }),
    ]);

    mockPrisma.homeEvent.findMany.mockResolvedValueOnce([
      {
        id: 'event_1',
        title: 'Home briefing',
        description: 'Safeguarding briefing',
        startsAt: d('2026-04-01T07:00:00.000Z'),
        homeId: 'home_1',
        home: { id: 'home_1', name: 'Northbridge Home' },
      },
    ]);

    mockPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit_1',
        action: 'record_updated',
        entityType: 'task',
        entityId: 'task_approval',
        metadata: null,
        createdAt: d('2026-04-01T12:00:00.000Z'),
        user: { firstName: 'Admin', lastName: 'User' },
      },
      {
        id: 'audit_1',
        action: 'record_updated',
        entityType: 'task',
        entityId: 'task_approval',
        metadata: null,
        createdAt: d('2026-04-01T12:00:00.000Z'),
        user: { firstName: 'Admin', lastName: 'User' },
      },
    ]);

    const response = await safeguardingService.getYoungPersonChronology('user_1', 'yp_1', {
      maxEvents: 200,
      includeNarrative: true,
    });

    expect(response.targetType).toBe('young_person');
    expect(response.target).toMatchObject({
      id: 'yp_1',
      homeId: 'home_1',
    });
    expect(response.summary.totalEvents).toBe(7);
    expect(response.chronology.filter((event) => event.eventType === 'audit')).toHaveLength(1);
    expect(response.narrative?.source).toBe('fallback');
    expect(response.narrative?.qualityChecks).toMatchObject({
      version: 'chronology-empathy-v1',
      childCentred: true,
      evidenceGrounded: true,
      nonBlamingLanguage: true,
      passed: true,
    });

    const timestamps = response.chronology.map((event) => event.timestamp);
    expect(timestamps).toEqual([...timestamps].sort());
    response.chronology.forEach((event) => {
      expect(event.evidenceRef.entityId.length).toBeGreaterThan(0);
      expect(event.evidenceRef.route.startsWith('/')).toBe(true);
    });
  });

  it('applies event-type, severity, and source filters for home chronology', async () => {
    mockPrisma.home.findFirst.mockResolvedValueOnce({
      id: 'home_1',
      name: 'Northbridge Home',
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeTask({
        id: 'task_rejected',
        title: 'Rejected approval task',
        category: 'checklist',
        approvalStatus: 'rejected',
        approvedAt: d('2026-04-01T11:00:00.000Z'),
        createdAt: d('2026-04-01T09:00:00.000Z'),
        updatedAt: d('2026-04-01T09:00:00.000Z'),
        youngPerson: null,
      }),
    ]);

    mockPrisma.homeEvent.findMany.mockResolvedValueOnce([]);
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    const response = await safeguardingService.getHomeChronology('user_1', 'home_1', {
      eventType: 'approval',
      severity: 'high',
      source: 'tasks',
      maxEvents: 200,
      includeNarrative: false,
    });

    expect(response.targetType).toBe('home');
    expect(response.chronology).toHaveLength(1);
    expect(response.chronology[0]).toMatchObject({
      eventType: 'approval',
      severity: 'high',
      source: 'tasks',
    });
    expect(response.narrative).toBeNull();
  });

  it('applies confidentiality redaction in standard scope for chronology payloads', async () => {
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce({
      id: 'yp_1',
      firstName: 'Ava',
      lastName: 'Morris',
      homeId: 'home_1',
      home: { id: 'home_1', name: 'Northbridge Home' },
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeTask({
        id: 'task_sensitive_1',
        title: 'Incident report for Ava Morris',
        description: 'Contact parent at ava.morris@example.com or +44 7000 555 111.',
        category: 'incident',
        createdAt: d('2026-04-01T10:00:00.000Z'),
        updatedAt: d('2026-04-01T10:00:00.000Z'),
      }),
    ]);
    mockPrisma.homeEvent.findMany.mockResolvedValueOnce([]);
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    const response = await safeguardingService.getYoungPersonChronology('user_1', 'yp_1', {
      maxEvents: 50,
      includeNarrative: true,
    });

    expect(response.confidentiality).toMatchObject({
      requestedScope: 'standard',
      effectiveScope: 'standard',
    });
    expect(response.target.name).toBe('A.M.');
    expect(response.chronology[0]?.description).toContain('[redacted-email]');
    expect(response.chronology[0]?.description).toContain('[redacted-phone]');
    expect(response.chronology[0]?.evidenceRef.entityId).not.toBe('task_sensitive_1');
    expect(response.filtersApplied.confidentialityScope).toBe('standard');
  });

  it('rejects restricted confidentiality scope for non-privileged actors', async () => {
    requireTenantContext.mockResolvedValueOnce({
      tenantId: 'tenant_1',
      userRole: 'staff',
      tenantRole: 'staff',
    });
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce({
      id: 'yp_1',
      firstName: 'Ava',
      lastName: 'Morris',
      homeId: 'home_1',
      home: { id: 'home_1', name: 'Northbridge Home' },
    });

    await expect(
      safeguardingService.getYoungPersonChronology('user_1', 'yp_1', {
        confidentialityScope: 'restricted',
        maxEvents: 50,
        includeNarrative: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'CONFIDENTIAL_SCOPE_FORBIDDEN',
    });
  });

  it('returns not found for unknown young person', async () => {
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce(null);

    await expect(
      safeguardingService.getYoungPersonChronology('user_1', 'missing', {
        maxEvents: 200,
        includeNarrative: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'YOUNG_PERSON_NOT_FOUND',
    });
  });

  it('returns mandatory reflective prompts with context-aware extras', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      title: 'PRN medication refusal incident',
      description: 'Child refused evening PRN medication.',
      category: 'incident',
      formTemplateKey: 'incident_medication',
      formGroup: 'incident',
      createdById: 'user_1',
      assigneeId: 'employee_1',
      submissionPayload: null,
    });

    const response = await safeguardingService.getReflectivePromptSet('user_1', {
      taskId: 'task_1',
      includeOptional: true,
    });

    const promptIds = response.promptSet.prompts.map((prompt) => prompt.id);
    expect(response.promptSet.version).toBe('v1');
    expect(promptIds).toEqual(expect.arrayContaining([
      'communication_signal',
      'underlying_emotion',
      'regulation_support',
      'medication_context',
      'medication_safety_next',
    ]));
    expect(response.promptSet.mandatoryPromptIds).toEqual(
      expect.arrayContaining(['communication_signal', 'underlying_emotion', 'regulation_support']),
    );
    expect(response.promptSet.context).toMatchObject({
      contextCategory: 'incident',
      incidentType: 'medication',
      safeguardingClass: 'medication_safety',
    });
  });

  it('persists reflective responses in submissionPayload structured sections', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      title: 'Medication refusal incident',
      description: 'Escalated behaviour at medication round.',
      category: 'incident',
      formTemplateKey: 'incident_medication',
      formGroup: 'incident',
      createdById: 'user_1',
      assigneeId: 'employee_1',
      submissionPayload: {
        sections: [{ id: 'existing', type: 'notes', label: 'Existing', entries: [] }],
      },
    });
    mockPrisma.task.update.mockResolvedValueOnce({ id: 'task_1' });

    const saved = await safeguardingService.saveReflectivePromptResponses(
      'user_1',
      'task_1',
      {
        source: 'manual',
        responses: [
          { promptId: 'communication_signal', response: 'Child was communicating fear of side effects.' },
          { promptId: 'underlying_emotion', response: 'Likely anxiety and low trust.' },
          { promptId: 'regulation_support', response: 'Calm tone and choice of timing helped.' },
        ],
      },
    );

    expect(saved.taskId).toBe('task_1');
    expect(saved.reflectivePrompts.mandatoryAnsweredCount).toBe(3);
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task_1' },
        data: expect.objectContaining({
          updatedById: 'user_1',
          submissionPayload: expect.objectContaining({
            reflectivePrompts: expect.objectContaining({
              version: 'v1',
              source: 'manual',
              mandatoryAnsweredCount: 3,
            }),
            sections: expect.arrayContaining([
              expect.objectContaining({ id: 'existing' }),
              expect.objectContaining({ id: 'reflective_prompts', type: 'therapeutic_reflection' }),
            ]),
          }),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'task_reflective_prompts',
          entityId: 'task_1',
        }),
      }),
    );
  });

  it('rejects save when mandatory reflective prompts are missing', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      title: 'Medication refusal incident',
      description: 'Escalated behaviour at medication round.',
      category: 'incident',
      formTemplateKey: 'incident_medication',
      formGroup: 'incident',
      createdById: 'user_1',
      assigneeId: 'employee_1',
      submissionPayload: null,
    });

    await expect(
      safeguardingService.saveReflectivePromptResponses('user_1', 'task_1', {
        source: 'manual',
        responses: [
          { promptId: 'communication_signal', response: 'Some response' },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'MANDATORY_PROMPTS_INCOMPLETE',
    });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });
});
