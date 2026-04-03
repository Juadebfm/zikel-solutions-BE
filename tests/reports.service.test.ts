import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const { mockPrisma, requireTenantContext } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    home: { findFirst: vi.fn(), findMany: vi.fn() },
    careGroup: { findFirst: vi.fn() },
    task: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    employee: { count: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    homeEvent: { findMany: vi.fn() },
    employeeShift: { count: vi.fn(), findMany: vi.fn() },
    supportTicket: { count: vi.fn() },
    safeguardingRiskAlert: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  },
  requireTenantContext: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));

import * as reportsService from '../src/modules/reports/reports.service.js';

const toDate = (iso: string) => new Date(iso);

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    title: 'Medication review task',
    category: 'incident',
    status: 'pending',
    approvalStatus: 'pending_approval',
    priority: 'high',
    createdAt: toDate('2026-04-01T10:00:00.000Z'),
    dueDate: toDate('2026-04-02T10:00:00.000Z'),
    completedAt: null,
    description: 'Safeguarding follow-up required.',
    home: { id: 'home_1', name: 'Northbridge Home' },
    assignee: {
      id: 'employee_1',
      user: { firstName: 'Alex', lastName: 'Green' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  requireTenantContext.mockResolvedValue({
    tenantId: 'tenant_1',
    tenantRole: 'tenant_admin',
  });
  mockPrisma.home.findMany.mockResolvedValue([]);
  mockPrisma.careGroup.findFirst.mockResolvedValue({ id: 'cg_1' });
  mockPrisma.task.groupBy.mockResolvedValue([]);
  mockPrisma.safeguardingRiskAlert.groupBy.mockResolvedValue([]);
  mockPrisma.safeguardingRiskAlert.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit_1' });
});

describe('reports.service', () => {
  it('generates a reg44 evidence pack with chronology and checksum', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@example.com',
    });

    mockPrisma.task.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockPrisma.employee.count.mockResolvedValueOnce(9);
    mockPrisma.supportTicket.count.mockResolvedValueOnce(2);

    mockPrisma.task.findMany
      .mockResolvedValueOnce([
        makeTask({
          id: 'incident_1',
          category: 'incident',
          createdAt: toDate('2026-04-01T09:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({
          id: 'daily_1',
          category: 'daily_log',
          createdAt: toDate('2026-04-01T08:00:00.000Z'),
          title: 'Daily log entry',
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({
          id: 'reg_1',
          category: 'general',
          createdAt: toDate('2026-04-01T07:00:00.000Z'),
          title: 'Reg44 quality check',
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({
          id: 'approval_1',
          category: 'general',
          createdAt: toDate('2026-04-01T06:00:00.000Z'),
          approvalStatus: 'approved',
          title: 'Approval evidence',
        }),
      ]);

    mockPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit_1',
        action: 'permission_changed',
        entityType: 'user',
        entityId: 'user_3',
        createdAt: toDate('2026-04-01T05:00:00.000Z'),
        user: { firstName: 'Admin', lastName: 'User' },
      },
    ]);

    mockPrisma.homeEvent.findMany.mockResolvedValueOnce([
      {
        id: 'event_1',
        title: 'Home event',
        startsAt: toDate('2026-04-01T04:00:00.000Z'),
        endsAt: null,
        home: { name: 'Northbridge Home' },
      },
    ]);

    mockPrisma.employeeShift.findMany.mockResolvedValueOnce([
      {
        id: 'shift_1',
        startTime: toDate('2026-04-01T03:00:00.000Z'),
        endTime: toDate('2026-04-01T11:00:00.000Z'),
        home: { name: 'Northbridge Home' },
        employee: { user: { firstName: 'Alex', lastName: 'Green' } },
      },
    ]);

    const pack = await reportsService.generateEvidencePack('user_1', 'reg44', {
      maxEvidenceItems: 200,
      format: 'json',
    });

    expect(pack.packType).toBe('reg44');
    expect(pack.generatedBy).toMatchObject({
      id: 'user_1',
      name: 'Admin User',
      email: 'admin@example.com',
    });
    expect(pack.summary.totals).toMatchObject({
      totalTasks: 12,
      overdueTasks: 2,
      pendingApprovals: 3,
      incidents: 1,
      dailyLogs: 1,
      regTaggedRecords: 1,
    });
    expect(pack.chronology.length).toBeGreaterThan(0);
    expect(pack.provenance.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pack.sections.governance.highlights.join(' ')).toContain('permission-change');

    const exported = reportsService.toEvidencePackExport(pack);
    expect(exported.title).toBe('Reg 44 Evidence Pack');
    expect(exported.columns.length).toBeGreaterThan(0);
    expect(exported.rows.length).toBeGreaterThan(0);

    const zipped = await reportsService.toEvidencePackZipBundle({
      pack,
      pdf: {
        buffer: Buffer.from('pdf-data'),
        contentType: 'application/pdf',
        filename: 'reg44-evidence-pack-2026-04-02.pdf',
      },
      excel: {
        buffer: Buffer.from('excel-data'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: 'reg44-evidence-pack-2026-04-02.xlsx',
      },
    });

    expect(zipped.contentType).toBe('application/zip');
    expect(zipped.filename).toContain('evidence-bundle');
    const opened = await JSZip.loadAsync(zipped.buffer);
    expect(Object.keys(opened.files)).toEqual(
      expect.arrayContaining([
        'README.txt',
        'manifest.json',
        'pack/evidence-pack.json',
        'pack/reg44-evidence-pack-2026-04-02.pdf',
        'pack/reg44-evidence-pack-2026-04-02.xlsx',
        'evidence/chronology.json',
      ]),
    );
  });

  it('rejects when home scope is requested for a non-existent home', async () => {
    mockPrisma.home.findFirst.mockResolvedValueOnce(null);

    await expect(
      reportsService.generateEvidencePack('user_1', 'reg45', {
        homeId: 'missing_home',
        maxEvidenceItems: 200,
        format: 'json',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'HOME_NOT_FOUND',
    });
  });

  it('builds RI monitoring dashboard aggregates and logs dashboard access', async () => {
    mockPrisma.task.count
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(24)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2);
    mockPrisma.employee.count.mockResolvedValueOnce(12);
    mockPrisma.employeeShift.count.mockResolvedValueOnce(10);
    mockPrisma.safeguardingRiskAlert.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    mockPrisma.task.groupBy
      .mockResolvedValueOnce([
        { homeId: 'home_1', _count: { _all: 8 } },
        { homeId: 'home_2', _count: { _all: 6 } },
      ])
      .mockResolvedValueOnce([
        { homeId: 'home_1', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { homeId: 'home_1', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { homeId: 'home_2', _count: { _all: 1 } },
      ]);

    mockPrisma.safeguardingRiskAlert.groupBy.mockResolvedValueOnce([
      { homeId: 'home_1', severity: 'critical', _count: { _all: 1 } },
      { homeId: 'home_2', severity: 'high', _count: { _all: 1 } },
      { homeId: 'home_2', severity: 'medium', _count: { _all: 1 } },
    ]);

    mockPrisma.home.findMany.mockResolvedValueOnce([
      { id: 'home_1', name: 'Northbridge Home', careGroup: { id: 'cg_1', name: 'North Region' } },
      { id: 'home_2', name: 'Lakeside Home', careGroup: { id: 'cg_2', name: 'South Region' } },
    ]);

    const report = await reportsService.generateRiDashboard('user_1', { format: 'json' });

    expect(report.kpis.compliance).toMatchObject({
      pendingApprovals: 3,
      rejectedApprovals: 1,
      overdueTasks: 4,
    });
    expect(report.kpis.safeguardingRisk.openAlerts).toMatchObject({
      total: 3,
      critical: 1,
      high: 1,
      medium: 1,
    });
    expect(report.atRiskHomes[0]).toMatchObject({
      homeId: 'home_1',
      homeName: 'Northbridge Home',
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'record_accessed',
          entityType: 'ri_dashboard_overview',
        }),
      }),
    );

    const exported = reportsService.toRiDashboardOverviewExport(report);
    expect(exported.title).toBe('RI Monitoring Dashboard');
    expect(exported.rows.length).toBeGreaterThan(0);
  });

  it('returns RI drilldown rows with pagination for compliance metric', async () => {
    mockPrisma.task.count.mockResolvedValueOnce(2);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_1',
        title: 'Pending approval medication check',
        status: 'pending',
        approvalStatus: 'pending_approval',
        priority: 'high',
        assigneeId: null,
        dueDate: toDate('2026-04-03T12:00:00.000Z'),
        createdAt: toDate('2026-04-02T12:00:00.000Z'),
        home: { id: 'home_1', name: 'Northbridge Home', careGroup: { id: 'cg_1', name: 'North Region' } },
      },
    ]);

    const report = await reportsService.generateRiDashboardDrilldown('user_1', {
      metric: 'compliance',
      page: 1,
      pageSize: 1,
      format: 'json',
    });

    expect(report.meta).toMatchObject({ total: 2, page: 1, pageSize: 1, totalPages: 2 });
    expect(report.data[0]).toMatchObject({
      metric: 'compliance',
      signal: 'pending_signoff',
      referenceType: 'task',
    });
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 1,
      }),
    );

    const exported = reportsService.toRiDashboardDrilldownExport(report);
    expect(exported.title).toBe('RI Monitoring Drilldown');
    expect(exported.rows.length).toBe(1);
  });

  it('keeps drilldown workload bounded at pageSize for high-volume queries', async () => {
    mockPrisma.task.count.mockResolvedValueOnce(5000);
    mockPrisma.task.findMany.mockResolvedValueOnce(
      Array.from({ length: 200 }, (_, index) => ({
        id: `task_${index + 1}`,
        title: `High volume task ${index + 1}`,
        status: 'pending',
        approvalStatus: 'not_required',
        priority: 'high',
        assigneeId: null,
        dueDate: toDate('2026-04-05T12:00:00.000Z'),
        createdAt: toDate('2026-04-02T12:00:00.000Z'),
        home: { id: 'home_1', name: 'Northbridge Home', careGroup: { id: 'cg_1', name: 'North Region' } },
      })),
    );

    const startedAt = Date.now();
    const report = await reportsService.generateRiDashboardDrilldown('user_1', {
      metric: 'staffing_pressure',
      page: 1,
      pageSize: 200,
      format: 'json',
    });
    const elapsedMs = Date.now() - startedAt;

    expect(report.data).toHaveLength(200);
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
    expect(elapsedMs).toBeLessThan(1000);
  });
});
