import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, requireTenantContext } = vi.hoisted(() => ({
  mockPrisma: {
    youngPerson: { findFirst: vi.fn() },
    home: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
  },
  requireTenantContext: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));

import * as patternsService from '../src/modules/safeguarding/patterns.service.js';

const d = (iso: string) => new Date(iso);

function makeIncidentTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_incident_1',
    title: 'Incident: medication refusal and aggression',
    description: 'Young person refused medication and became aggressive.',
    priority: 'high',
    status: 'pending',
    approvalStatus: 'pending_approval',
    dueDate: null,
    createdAt: d('2026-04-01T09:00:00.000Z'),
    updatedAt: d('2026-04-01T09:30:00.000Z'),
    submittedAt: d('2026-04-01T09:05:00.000Z'),
    submissionPayload: {
      trigger: ['Medication refusal', 'Aggression'],
      outcomes: ['De-escalation conversation', 'Staff support provided'],
      staffInvolved: ['Shift Leader', 'Support Worker'],
      location: 'Dining Area',
      incidentTime: '2026-04-01T09:02:00.000Z',
    },
    homeId: 'home_1',
    youngPersonId: 'yp_1',
    home: { id: 'home_1', name: 'Northbridge Home' },
    youngPerson: { id: 'yp_1', firstName: 'Ava', lastName: 'Morris' },
    assignee: { jobTitle: 'Senior Support Worker', role: { name: 'Residential Support' } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantContext.mockResolvedValue({
    tenantId: 'tenant_1',
    userRole: 'admin',
    tenantRole: 'tenant_admin',
  });
  process.env.SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE = 'standard';
  process.env.SAFEGUARDING_PATTERNS_RETENTION_DAYS = '365';
});

describe('safeguarding incident patterns service', () => {
  it('builds normalized incident features and explainable patterns', async () => {
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce({
      id: 'yp_1',
      firstName: 'Ava',
      lastName: 'Morris',
      homeId: 'home_1',
      home: { id: 'home_1', name: 'Northbridge Home' },
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeIncidentTask({ id: 'inc_1', createdAt: d('2026-04-01T08:00:00.000Z'), submittedAt: d('2026-04-01T08:02:00.000Z') }),
      makeIncidentTask({ id: 'inc_2', createdAt: d('2026-04-01T10:00:00.000Z'), submittedAt: d('2026-04-01T10:04:00.000Z') }),
      makeIncidentTask({ id: 'inc_3', createdAt: d('2026-04-01T13:00:00.000Z'), submittedAt: d('2026-04-01T13:05:00.000Z') }),
      makeIncidentTask({
        id: 'inc_4',
        title: 'Incident: physical aggression in lounge',
        description: 'Aggression towards staff in the lounge.',
        createdAt: d('2026-04-03T11:00:00.000Z'),
        submittedAt: d('2026-04-03T11:10:00.000Z'),
        submissionPayload: {
          trigger: ['Aggression'],
          outcomes: ['Calming approach used'],
          staffInvolved: ['Support Worker'],
          location: 'Lounge',
          incidentTime: '2026-04-03T11:07:00.000Z',
        },
      }),
      makeIncidentTask({
        id: 'inc_5',
        title: 'Incident: aggressive behaviour and refusal',
        description: 'Refused medication and shouted at staff.',
        createdAt: d('2026-04-04T09:00:00.000Z'),
        submittedAt: d('2026-04-04T09:06:00.000Z'),
      }),
    ]);

    const response = await patternsService.getYoungPersonIncidentPatterns(
      'user_1',
      'yp_1',
      {
        maxIncidents: 500,
        minOccurrences: 3,
        confidenceThreshold: 0.4,
        maxPatterns: 20,
      },
    );

    expect(response.targetType).toBe('young_person');
    expect(response.summary.totalIncidents).toBe(5);
    expect(response.normalizedIncidents[0]).toMatchObject({
      location: { area: expect.any(String) },
      triggerTags: expect.arrayContaining(['aggression']),
    });
    expect(response.patterns.clusters.length).toBeGreaterThan(0);
    expect(response.patterns.recurrence.length).toBeGreaterThan(0);
    expect(response.patterns.coOccurrence.length).toBeGreaterThan(0);
    expect(response.insights.patternInsightSummaries.length).toBeGreaterThan(0);
    expect(response.insights.exploreNext.length).toBeGreaterThan(0);

    const sampleSignal = response.patterns.clusters[0];
    expect(sampleSignal.whyFlagged.length).toBeGreaterThan(20);
    expect(sampleSignal.confidence).toBeGreaterThanOrEqual(0.4);
    expect(sampleSignal.evidenceReferences.length).toBeGreaterThan(0);
  });

  it('suppresses low-evidence pattern noise via minimum occurrence thresholds', async () => {
    mockPrisma.home.findFirst.mockResolvedValueOnce({
      id: 'home_1',
      name: 'Northbridge Home',
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeIncidentTask({ id: 'inc_low_1', createdAt: d('2026-04-02T08:00:00.000Z') }),
      makeIncidentTask({
        id: 'inc_low_2',
        title: 'Incident: isolated refusal',
        description: 'Single refusal with no repeat cluster.',
        createdAt: d('2026-04-05T11:00:00.000Z'),
        submissionPayload: {
          trigger: ['Refusal'],
          outcomes: ['Conversation held'],
          staffInvolved: ['Support Worker'],
          location: 'Hallway',
          incidentTime: '2026-04-05T11:00:00.000Z',
        },
      }),
    ]);

    const response = await patternsService.getHomeIncidentPatterns(
      'user_1',
      'home_1',
      {
        maxIncidents: 500,
        minOccurrences: 3,
        confidenceThreshold: 0.55,
        maxPatterns: 20,
      },
    );

    expect(response.summary.totalIncidents).toBe(2);
    expect(response.summary.flaggedPatterns).toBe(0);
    expect(response.patterns.frequency).toHaveLength(0);
    expect(response.patterns.clusters).toHaveLength(0);
    expect(response.patterns.recurrence).toHaveLength(0);
    expect(response.patterns.coOccurrence).toHaveLength(0);
    expect(response.insights.patternInsightSummaries.length).toBeGreaterThan(0);
  });

  it('enforces tenant isolation for home pattern scope lookups', async () => {
    mockPrisma.home.findFirst.mockResolvedValueOnce(null);

    await expect(
      patternsService.getHomeIncidentPatterns(
        'user_1',
        'home_outside_tenant',
        {
          maxIncidents: 500,
          minOccurrences: 3,
          confidenceThreshold: 0.55,
          maxPatterns: 20,
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'HOME_NOT_FOUND',
    });
  });

  it('redacts identifiers/text in standard confidentiality scope pattern outputs', async () => {
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce({
      id: 'yp_1',
      firstName: 'Ava',
      lastName: 'Morris',
      homeId: 'home_1',
      home: { id: 'home_1', name: 'Northbridge Home' },
    });

    mockPrisma.task.findMany.mockResolvedValueOnce([
      makeIncidentTask({
        id: 'inc_sensitive_1',
        description: 'Escalation discussed with ava.morris@example.com.',
      }),
      makeIncidentTask({
        id: 'inc_sensitive_2',
        description: 'Follow-up by phone +44 7000 111 222.',
      }),
      makeIncidentTask({
        id: 'inc_sensitive_3',
        description: 'Repeat observation in lounge.',
      }),
    ]);

    const response = await patternsService.getYoungPersonIncidentPatterns(
      'user_1',
      'yp_1',
      {
        maxIncidents: 500,
        minOccurrences: 2,
        confidenceThreshold: 0.4,
        maxPatterns: 20,
      },
    );

    expect(response.confidentiality).toMatchObject({
      requestedScope: 'standard',
      effectiveScope: 'standard',
    });
    expect(response.target.name).toBe('A.M.');
    expect(response.filtersApplied.confidentialityScope).toBe('standard');
    expect(response.normalizedIncidents[0]?.evidenceRef.entityId).not.toBe('inc_sensitive_1');
  });
});
