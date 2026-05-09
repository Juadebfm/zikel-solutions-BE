import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  mockPrisma,
  generateEvidencePack,
  toEvidencePackExport,
  toEvidencePackZipBundle,
  generateRiDashboard,
  generateRiDashboardDrilldown,
  toRiDashboardOverviewExport,
  toRiDashboardDrilldownExport,
  generateExport,
} = vi.hoisted(() => ({
  mockPrisma: (() => {
    const mp = {
      tenantUser: { findUnique: vi.fn() },
      auditLog: { create: vi.fn(async () => ({ id: 'audit_1' })) },
      $transaction: vi.fn(),
      $disconnect: vi.fn(async () => undefined),
      $on: vi.fn(),
      $extends: vi.fn(),
      $queryRawUnsafe: vi.fn(async () => []),
    };
    mp.$transaction.mockImplementation(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    });
    mp.$extends.mockReturnValue(mp);
    return mp;
  })(),
  generateEvidencePack: vi.fn(),
  toEvidencePackExport: vi.fn(),
  toEvidencePackZipBundle: vi.fn(),
  generateRiDashboard: vi.fn(),
  generateRiDashboardDrilldown: vi.fn(),
  toRiDashboardOverviewExport: vi.fn(),
  toRiDashboardDrilldownExport: vi.fn(),
  generateExport: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

vi.mock('../src/modules/reports/reports.service.js', () => ({
  generateEvidencePack,
  toEvidencePackExport,
  toEvidencePackZipBundle,
  generateRiDashboard,
  generateRiDashboardDrilldown,
  toRiDashboardOverviewExport,
  toRiDashboardDrilldownExport,
}));

vi.mock('../src/lib/export.js', () => ({
  generateExport,
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

// Owner permissions cover every reports endpoint via requirePermission(...).
// Mirrors src/auth/permissions.ts → SYSTEM_ROLE_PERMISSIONS.Owner.
const OWNER_PERMISSIONS = [
  'employees:read', 'employees:write', 'employees:deactivate', 'employees:invite',
  'homes:read', 'homes:write',
  'care_groups:read', 'care_groups:write',
  'young_people:read', 'young_people:write', 'young_people:sensitive_read',
  'tasks:read', 'tasks:write', 'tasks:approve',
  'care_logs:read', 'care_logs:write',
  'safeguarding:read', 'safeguarding:write', 'safeguarding:escalate',
  'reports:read', 'reports:export',
  'audit:read',
  'settings:read', 'settings:write',
  'members:read', 'members:write',
  'roles:read', 'roles:write',
  'billing:read', 'billing:write',
  'ai:use', 'ai:admin',
  'announcements:read', 'announcements:write',
  'vehicles:read', 'vehicles:write',
  'help_center:admin',
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default tenant context: an Owner with full permissions so
  // requirePermission(...) passes for every report endpoint. Individual tests
  // can override mockPrisma.tenantUser.findUnique for negative cases.
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: 'user_1',
    role: 'admin',
    activeTenantId: 'tenant_1',
    activeTenant: { id: 'tenant_1', isActive: true },
    tenantMemberships: [
      {
        tenantId: 'tenant_1',
        status: 'active',
        role: { name: 'Owner', permissions: OWNER_PERMISSIONS },
      },
    ],
  });
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

const MOCK_PACK = {
  packType: 'reg44',
  title: 'Reg 44 Evidence Pack',
  generatedAt: '2026-04-02T10:00:00.000Z',
  generatedBy: {
    id: 'user_42',
    name: 'Admin User',
    email: 'admin@example.com',
  },
  scope: {
    tenantId: 'tenant_1',
    homeId: null,
    dateFrom: '2026-03-01T00:00:00.000Z',
    dateTo: '2026-04-01T23:59:59.999Z',
    timezone: 'UTC',
  },
  summary: {
    headline: 'Reg 44 evidence pack shows stable activity within the selected period.',
    riskLevel: 'low',
    riskScore: 10,
    totals: {
      totalTasks: 4,
      openTasks: 2,
      completedTasks: 2,
      overdueTasks: 0,
      unassignedActiveTasks: 0,
      incidents: 1,
      dailyLogs: 1,
      pendingApprovals: 1,
      rejectedApprovals: 0,
      approvedApprovals: 1,
      regTaggedRecords: 1,
      auditEvents: 2,
      homeEvents: 1,
      scheduledShifts: 1,
      activeEmployees: 5,
      openSupportTickets: 1,
    },
  },
  sections: {
    compliance: { summary: 'ok', metrics: { regTaggedRecords: 1 }, gaps: [], highlights: [] },
    safeguarding: { summary: 'ok', metrics: { incidents: 1 }, topIncidentThemes: [], gaps: [] },
    staffing: { summary: 'ok', metrics: { activeEmployees: 5 }, gaps: [] },
    governance: { summary: 'ok', metrics: { auditEvents: 2 }, highlights: [] },
  },
  chronology: [],
  evidence: {
    regulatory: [],
    incidents: [],
    dailyLogs: [],
    approvals: [],
    audits: [],
    homeEvents: [],
    shifts: [],
  },
  provenance: {
    generatedByUserId: 'user_42',
    generatedAt: '2026-04-02T10:00:00.000Z',
    sourceCounts: {},
    checksumSha256: 'abc',
  },
};

describe('Reports routes', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reg44-pack',
    });

    expect(res.statusCode).toBe(401);
  });

  it('forbids staff user without report role scope', async () => {
    // Override default Owner mock — staff role lacks `reports:read` permission.
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'staff_user',
      role: 'staff',
      activeTenantId: 'tenant_1',
      activeTenant: { id: 'tenant_1', isActive: true },
      tenantMemberships: [
        {
          tenantId: 'tenant_1',
          status: 'active',
          role: { name: 'Care Worker', permissions: ['care_logs:read', 'care_logs:write'] },
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reg44-pack',
      headers: authHeader('staff_user', 'staff', 'staff'),
    });

    expect(res.statusCode).toBe(403);
    expect(generateEvidencePack).not.toHaveBeenCalled();
  });

  it('returns JSON evidence pack for Reg 44', async () => {
    generateEvidencePack.mockResolvedValueOnce(MOCK_PACK);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reg44-pack?maxEvidenceItems=200',
      headers: authHeader('user_42', 'manager'),
    });

    expect(res.statusCode).toBe(200);
    expect(generateEvidencePack).toHaveBeenCalledWith('user_42', 'reg44', {
      maxEvidenceItems: 200,
      format: 'json',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        packType: 'reg44',
      },
    });
  });

  it('returns PDF export for Reg 45', async () => {
    generateEvidencePack.mockResolvedValueOnce({
      ...MOCK_PACK,
      packType: 'reg45',
      title: 'Reg 45 Evidence Pack',
    });
    toEvidencePackExport.mockReturnValueOnce({
      title: 'Reg 45 Evidence Pack',
      subtitle: '2026-03-01 to 2026-04-01',
      columns: [{ header: 'Section', key: 'section' }],
      rows: [{ section: 'Summary' }],
    });
    generateExport.mockResolvedValueOnce({
      buffer: Buffer.from('pdf-data'),
      contentType: 'application/pdf',
      filename: 'reg45-evidence-pack-2026-04-02.pdf',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reg45-pack?format=pdf',
      headers: authHeader('user_55', 'admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(generateEvidencePack).toHaveBeenCalledWith('user_55', 'reg45', {
      format: 'pdf',
      maxEvidenceItems: 200,
    });
    expect(generateExport).toHaveBeenCalledTimes(1);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
  });

  it('returns ZIP evidence bundle', async () => {
    generateEvidencePack.mockResolvedValueOnce(MOCK_PACK);
    toEvidencePackExport.mockReturnValueOnce({
      title: 'Reg 44 Evidence Pack',
      subtitle: '2026-03-01 to 2026-04-01',
      columns: [{ header: 'Section', key: 'section' }],
      rows: [{ section: 'Summary' }],
    });
    generateExport
      .mockResolvedValueOnce({
        buffer: Buffer.from('pdf-data'),
        contentType: 'application/pdf',
        filename: 'reg44-evidence-pack-2026-04-02.pdf',
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from('excel-data'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'reg44-evidence-pack-2026-04-02.xlsx',
      });
    toEvidencePackZipBundle.mockResolvedValueOnce({
      buffer: Buffer.from('zip-data'),
      contentType: 'application/zip',
      filename: 'reg44-evidence-bundle-2026-04-02.zip',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/reg44-pack?format=zip',
      headers: authHeader('user_zip', 'admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(generateExport).toHaveBeenCalledTimes(2);
    expect(generateExport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        format: 'pdf',
      }),
    );
    expect(generateExport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        format: 'excel',
      }),
    );
    expect(toEvidencePackZipBundle).toHaveBeenCalledTimes(1);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
  });

  it('returns RI dashboard JSON', async () => {
    generateRiDashboard.mockResolvedValueOnce({
      generatedAt: '2026-04-03T12:00:00.000Z',
      scope: {
        tenantId: 'tenant_1',
        homeId: null,
        careGroupId: null,
        dateFrom: '2026-03-04T00:00:00.000Z',
        dateTo: '2026-04-03T23:59:59.999Z',
        timezone: 'UTC',
      },
      kpis: {
        compliance: { score: 82, level: 'good', pendingApprovals: 1, rejectedApprovals: 0, overdueTasks: 1 },
        safeguardingRisk: {
          score: 76,
          level: 'good',
          incidentTasks: 2,
          openAlerts: { total: 2, critical: 0, high: 1, medium: 1 },
        },
        staffingPressure: {
          score: 65,
          level: 'watch',
          activeEmployees: 12,
          scheduledShifts: 10,
          unassignedActiveTasks: 2,
          highPriorityOpenTasks: 3,
        },
        actionCompletion: {
          score: 79,
          level: 'good',
          completionRate: 0.79,
          completedTasks: 30,
          activeTasks: 8,
          approvalsClosed: 10,
          approvalsPending: 1,
        },
      },
      totals: {
        totalTasks: 40,
        activeTasks: 8,
        completedTasks: 30,
        overdueTasks: 1,
        pendingApprovals: 1,
        rejectedApprovals: 0,
        approvedApprovals: 10,
        incidentTasks: 2,
        openRiskAlerts: 2,
        activeEmployees: 12,
        scheduledShifts: 10,
      },
      highlights: ['1 overdue task'],
      atRiskHomes: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/ri-dashboard',
      headers: authHeader('ri_user', 'manager'),
    });

    expect(res.statusCode).toBe(200);
    expect(generateRiDashboard).toHaveBeenCalledWith('ri_user', { format: 'json' });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        kpis: {
          compliance: { score: 82 },
        },
      },
    });
  });

  it('returns RI drilldown export in excel format', async () => {
    generateRiDashboardDrilldown.mockResolvedValueOnce({
      generatedAt: '2026-04-03T12:00:00.000Z',
      scope: {
        tenantId: 'tenant_1',
        homeId: null,
        careGroupId: null,
        dateFrom: '2026-03-04T00:00:00.000Z',
        dateTo: '2026-04-03T23:59:59.999Z',
        timezone: 'UTC',
      },
      metric: 'compliance',
      data: [
        {
          id: 'task_1',
          metric: 'compliance',
          title: 'Pending approval task',
          signal: 'pending_signoff',
          status: 'pending/pending_approval',
          priority: 'high',
          severity: null,
          homeId: 'home_1',
          homeName: 'Northbridge Home',
          careGroupId: 'cg_1',
          careGroupName: 'North Region',
          dueAt: null,
          happenedAt: '2026-04-02T10:00:00.000Z',
          referenceType: 'task',
          referenceId: 'task_1',
        },
      ],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
    toRiDashboardDrilldownExport.mockReturnValueOnce({
      title: 'RI Drilldown',
      subtitle: 'metric:compliance',
      columns: [{ header: 'Title', key: 'title' }],
      rows: [{ title: 'Pending approval task' }],
    });
    generateExport.mockResolvedValueOnce({
      buffer: Buffer.from('excel-data'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'ri-drilldown.xlsx',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/ri-dashboard/drilldown?metric=compliance&format=excel',
      headers: authHeader('ri_user', 'admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(generateRiDashboardDrilldown).toHaveBeenCalledWith('ri_user', {
      metric: 'compliance',
      page: 1,
      pageSize: 20,
      format: 'excel',
    });
    expect(toRiDashboardDrilldownExport).toHaveBeenCalledTimes(1);
    expect(generateExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'excel',
      }),
    );
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns RI dashboard export in pdf format', async () => {
    generateRiDashboard.mockResolvedValueOnce({
      generatedAt: '2026-04-03T12:00:00.000Z',
      scope: {
        tenantId: 'tenant_1',
        homeId: null,
        careGroupId: null,
        dateFrom: '2026-03-04T00:00:00.000Z',
        dateTo: '2026-04-03T23:59:59.999Z',
        timezone: 'UTC',
      },
      kpis: {
        compliance: { score: 80, level: 'good', pendingApprovals: 0, rejectedApprovals: 0, overdueTasks: 1 },
        safeguardingRisk: {
          score: 74,
          level: 'watch',
          incidentTasks: 4,
          openAlerts: { total: 2, critical: 0, high: 1, medium: 1 },
        },
        staffingPressure: {
          score: 71,
          level: 'watch',
          activeEmployees: 12,
          scheduledShifts: 11,
          unassignedActiveTasks: 1,
          highPriorityOpenTasks: 2,
        },
        actionCompletion: {
          score: 75,
          level: 'good',
          completionRate: 0.75,
          completedTasks: 30,
          activeTasks: 10,
          approvalsClosed: 8,
          approvalsPending: 0,
        },
      },
      totals: {
        totalTasks: 40,
        activeTasks: 10,
        completedTasks: 30,
        overdueTasks: 1,
        pendingApprovals: 0,
        rejectedApprovals: 0,
        approvedApprovals: 8,
        incidentTasks: 4,
        openRiskAlerts: 2,
        activeEmployees: 12,
        scheduledShifts: 11,
      },
      highlights: ['1 overdue task'],
      atRiskHomes: [],
    });
    toRiDashboardOverviewExport.mockReturnValueOnce({
      title: 'RI Monitoring Dashboard',
      subtitle: '2026-03-04 to 2026-04-03',
      columns: [{ header: 'Metric', key: 'metric' }],
      rows: [{ metric: 'Compliance score', value: 80 }],
    });
    generateExport.mockResolvedValueOnce({
      buffer: Buffer.from('pdf-data'),
      contentType: 'application/pdf',
      filename: 'ri-dashboard.pdf',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/ri-dashboard?format=pdf',
      headers: authHeader('ri_user', 'manager'),
    });

    expect(res.statusCode).toBe(200);
    expect(toRiDashboardOverviewExport).toHaveBeenCalledTimes(1);
    expect(generateExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'pdf',
      }),
    );
    expect(res.headers['content-type']).toContain('application/pdf');
  });
});
