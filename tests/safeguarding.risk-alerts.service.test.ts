import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  emitNotification,
  emitWebhookEvent,
  sendSafeguardingRiskAlertEmail,
  requireTenantContext,
} = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';

  const mp: {
    tenant: { findMany: ReturnType<typeof vi.fn> };
    tenantMembership: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    tenantUser: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    youngPerson: { findFirst: ReturnType<typeof vi.fn> };
    task: { findMany: ReturnType<typeof vi.fn> };
    homeEvent: { findMany: ReturnType<typeof vi.fn> };
    safeguardingRiskAlert: {
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    safeguardingRiskAlertNote: { create: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  } = {
    tenant: { findMany: vi.fn() },
    tenantMembership: { findMany: vi.fn(), findFirst: vi.fn() },
    tenantUser: { findUnique: vi.fn(), findMany: vi.fn() },
    youngPerson: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
    homeEvent: { findMany: vi.fn() },
    safeguardingRiskAlert: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    safeguardingRiskAlertNote: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        safeguardingRiskAlert: mp.safeguardingRiskAlert,
        safeguardingRiskAlertNote: mp.safeguardingRiskAlertNote,
        auditLog: mp.auditLog,
      }),
    ),
  };

  return {
    mockPrisma: mp,
    emitNotification: vi.fn(),
    emitWebhookEvent: vi.fn(),
    sendSafeguardingRiskAlertEmail: vi.fn(),
    requireTenantContext: vi.fn(),
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/notification-emitter.js', () => ({ emitNotification }));
vi.mock('../src/lib/webhook-dispatcher.js', () => ({ emitWebhookEvent }));
vi.mock('../src/lib/email.js', () => ({ sendSafeguardingRiskAlertEmail }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));

import * as riskAlertService from '../src/modules/safeguarding/risk-alerts.service.js';

const d = (iso: string) => new Date(iso);

function makeTask(overrides: Record<string, unknown> = {}) {
  // Rule 1 ("high_severity_incident") requires `createdAt >= now - 24h`.
  // Use a recent timestamp so the test stays valid regardless of when it runs.
  const recent = new Date(Date.now() - 60 * 60 * 1_000); // 1h ago
  return {
    id: 'task_1',
    title: 'Incident: medication refusal',
    description: 'High-priority incident report',
    category: 'incident',
    status: 'pending',
    approvalStatus: 'pending_approval',
    priority: 'high',
    dueDate: null,
    createdAt: recent,
    updatedAt: recent,
    homeId: 'home_1',
    youngPersonId: 'yp_1',
    home: { id: 'home_1', name: 'Northbridge Home' },
    youngPerson: { id: 'yp_1', firstName: 'Ava', lastName: 'Morris' },
    ...overrides,
  };
}

function makeCreatedAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert_1',
    tenantId: 'tenant_1',
    type: 'high_severity_incident',
    severity: 'high',
    status: 'new',
    targetType: 'young_person',
    targetId: 'yp_1',
    homeId: 'home_1',
    youngPersonId: 'yp_1',
    ruleKey: 'high_severity_incident',
    dedupeKey: 'high_severity_incident:young_person:yp_1',
    title: 'High-severity incident detected (Ava Morris)',
    description: 'desc',
    evidence: {},
    windowStart: d('2026-04-02T00:00:00.000Z'),
    windowEnd: d('2026-04-03T00:00:00.000Z'),
    firstTriggeredAt: d('2026-04-03T00:00:00.000Z'),
    lastTriggeredAt: d('2026-04-03T00:00:00.000Z'),
    triggeredCount: 1,
    ownerUserId: null,
    acknowledgedById: null,
    acknowledgedAt: null,
    resolvedById: null,
    resolvedAt: null,
    lastEvaluatedAt: d('2026-04-03T00:00:00.000Z'),
    createdAt: d('2026-04-03T00:00:00.000Z'),
    updatedAt: d('2026-04-03T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE = 'standard';
  process.env.SAFEGUARDING_RISK_ALERT_RETENTION_DAYS = '365';
  process.env.AI_CONTEXT_REDACTION_SENSITIVE_KEYS = 'name,email,phone,address';

  mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'tenant_1' }]);
  // Phase 1: requireTenantContext returns the new TenantContext shape with
  // roleName + permissions[]; tenantRole is the legacy enum still present
  // for back-compat consumers.
  requireTenantContext.mockResolvedValue({
    tenantId: 'tenant_1',
    userRole: 'admin',
    tenantRole: 'tenant_admin',
    roleName: 'Owner',
    permissions: ['safeguarding:read', 'safeguarding:write', 'safeguarding:escalate'],
  });
  mockPrisma.tenantUser.findUnique.mockResolvedValue({ id: 'admin_1', role: 'admin' });

  mockPrisma.task.findMany.mockResolvedValue([makeTask()]);
  mockPrisma.homeEvent.findMany.mockResolvedValue([]);
  mockPrisma.youngPerson.findFirst.mockResolvedValue(null);

  mockPrisma.tenantMembership.findMany.mockResolvedValue([{ userId: 'admin_1' }]);
  mockPrisma.tenantUser.findMany.mockResolvedValue([
    { id: 'admin_1', email: 'admin@example.com', firstName: 'Admin' },
  ]);

  mockPrisma.safeguardingRiskAlert.findMany.mockResolvedValue([]);
  mockPrisma.safeguardingRiskAlert.create.mockResolvedValue(makeCreatedAlert());
  mockPrisma.safeguardingRiskAlert.update.mockResolvedValue(makeCreatedAlert());
  mockPrisma.safeguardingRiskAlert.count.mockResolvedValue(0);
});

describe('safeguarding risk alerts service', () => {
  it('creates and routes a new risk alert candidate', async () => {
    const result = await riskAlertService.evaluateRiskAlertsForTenant({
      tenantId: 'tenant_1',
      mode: 'event',
      sendEmailHooks: false,
    });

    expect(result.totalCandidates).toBeGreaterThanOrEqual(1);
    expect(result.createdCount).toBeGreaterThanOrEqual(1);
    expect(mockPrisma.safeguardingRiskAlert.create).toHaveBeenCalled();
    expect(emitNotification).toHaveBeenCalled();
    expect(emitWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant_1',
      eventType: 'safeguarding_risk_alert',
    }));
  });

  it('dedupes against existing active alert and avoids rerouting when severity did not rise', async () => {
    mockPrisma.safeguardingRiskAlert.findMany.mockResolvedValueOnce([
      {
        id: 'alert_existing',
        dedupeKey: 'high_severity_incident:young_person:yp_1',
        severity: 'high',
        status: 'acknowledged',
        triggeredCount: 2,
        ownerUserId: 'admin_1',
        firstTriggeredAt: d('2026-04-02T00:00:00.000Z'),
      },
    ]);

    const result = await riskAlertService.evaluateRiskAlertsForTenant({
      tenantId: 'tenant_1',
      mode: 'event',
      sendEmailHooks: false,
    });

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBeGreaterThanOrEqual(1);
    expect(result.routedCount).toBe(0);
    expect(mockPrisma.safeguardingRiskAlert.create).not.toHaveBeenCalled();
    expect(mockPrisma.safeguardingRiskAlert.update).toHaveBeenCalled();
    expect(emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('runs scheduled backfill across active tenants and isolates failures per tenant', async () => {
    mockPrisma.tenant.findMany.mockResolvedValueOnce([{ id: 'tenant_1' }, { id: 'tenant_2' }]);
    mockPrisma.task.findMany.mockImplementation((args: { where?: { tenantId?: string } }) => {
      if (args.where?.tenantId === 'tenant_2') {
        throw new Error('tenant_2_data_unavailable');
      }
      return Promise.resolve([makeTask()]);
    });

    const result = await riskAlertService.runScheduledRiskBackfill({
      lookbackHours: 168,
      sendEmailHooks: false,
    });

    expect(result.tenantCount).toBe(2);
    expect(result.succeededCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failedTenantIds).toEqual(['tenant_2']);
    expect(result.createdCount).toBeGreaterThanOrEqual(1);
  });

  it('supports escalation workflow transitions with acknowledgement note', async () => {
    const now = d('2026-04-03T11:00:00.000Z');
    const currentAlert = {
      ...makeCreatedAlert({ id: 'alert_chain', status: 'new' }),
      notes: [],
    };
    const updatedAlert = {
      ...makeCreatedAlert({
        id: 'alert_chain',
        status: 'acknowledged',
        acknowledgedById: 'admin_1',
        acknowledgedAt: now,
      }),
      notes: [],
    };
    const refreshedAlert = {
      ...updatedAlert,
      notes: [
        {
          id: 'note_1',
          alertId: 'alert_chain',
          tenantId: 'tenant_1',
          userId: 'admin_1',
          note: 'Reviewed and taking ownership.',
          isEscalation: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    mockPrisma.safeguardingRiskAlert.findFirst
      .mockResolvedValueOnce(currentAlert)
      .mockResolvedValueOnce(refreshedAlert);
    mockPrisma.safeguardingRiskAlert.update.mockResolvedValueOnce(updatedAlert);

    const result = await riskAlertService.acknowledgeRiskAlert('admin_1', 'alert_chain', {
      note: 'Reviewed and taking ownership.',
      sendEmailHooks: false,
    });

    expect(mockPrisma.safeguardingRiskAlert.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'alert_chain' },
      data: expect.objectContaining({
        status: 'acknowledged',
        acknowledgedById: 'admin_1',
      }),
    }));
    expect(mockPrisma.safeguardingRiskAlertNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        alertId: 'alert_chain',
        note: 'Reviewed and taking ownership.',
        isEscalation: false,
      }),
    }));
    expect(result.status).toBe('acknowledged');
    expect(result.notes).toHaveLength(1);
  });

  it('applies retention window and standard confidentiality scope when listing alerts', async () => {
    const createdAt = d('2026-04-03T10:00:00.000Z');
    mockPrisma.safeguardingRiskAlert.count.mockResolvedValueOnce(1);
    mockPrisma.safeguardingRiskAlert.findMany.mockResolvedValueOnce([
      {
        ...makeCreatedAlert({
          id: 'alert_list_1',
          targetId: 'yp_1234567890abcdef',
          title: 'Safeguarding alert for ava.morris@example.com',
          description: 'Call +44 7000 000 111 about this case.',
          createdAt,
        }),
        notes: [
          {
            id: 'note_1',
            alertId: 'alert_list_1',
            tenantId: 'tenant_1',
            userId: 'admin_1',
            note: 'Reach out to ava.morris@example.com',
            isEscalation: false,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      },
    ]);

    const result = await riskAlertService.listRiskAlerts('admin_1', {
      page: 1,
      pageSize: 20,
      includeNotes: true,
    });

    expect(mockPrisma.safeguardingRiskAlert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant_1',
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
    expect(result.data[0]?.confidentialityScope).toBe('standard');
    expect(result.data[0]?.targetId).not.toBe('yp_1234567890abcdef');
    expect(result.data[0]?.description).toContain('[redacted-phone]');
    expect(result.data[0]?.notes[0]?.note).toContain('[redacted-email]');
    expect(result.meta).toEqual(expect.objectContaining({
      retentionPolicyDays: 365,
      confidentiality: expect.objectContaining({ effectiveScope: 'standard' }),
    }));
  });
});
