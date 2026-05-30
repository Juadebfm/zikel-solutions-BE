/**
 * Unit tests for the generative-artifact lifecycle (Week 1, no AI).
 *
 * Covers:
 *   - createDailyLogSummaryDraft: fresh create + supersede on regenerate
 *   - getArtifact: tenant-scoping
 *   - editArtifact: optimistic concurrency, edit-history append, status bump
 *   - commitArtifact: locks the artifact, idempotency, audit log row
 *
 * These tests do not exercise the AI provider — that's a Week 2 concern.
 * Service callers pass a pre-computed `generated` blob; the lifecycle code
 * doesn't care where it came from.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyLogSummaryContent } from '../src/modules/generative/generative.schema.js';

const { mockPrisma, requireTenantContext } = vi.hoisted(() => ({
  mockPrisma: {
    home: { findFirst: vi.fn() },
    dailyLogSummary: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    generativeArtifact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(),
  },
  requireTenantContext: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  createDailyLogSummaryDraft,
  getArtifact,
  editArtifact,
  commitArtifact,
} = await import('../src/modules/generative/generative.service.js');

function makeContent(overrides: Partial<DailyLogSummaryContent> = {}): DailyLogSummaryContent {
  return {
    shiftHighlights: ['quiet day'],
    incidentsOfNote: [],
    safeguardingFlags: [],
    followUpRequired: [],
    freeformSummary: 'A quiet shift with no incidents to report.',
    languageSafetyPassed: true,
    ...overrides,
  };
}

function makeArtifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'art_1',
    tenantId: 't_1',
    artifactType: 'daily_log_summary',
    status: 'draft',
    entityType: 'home',
    entityId: 'h_1',
    sourceRecordIds: ['task_1', 'task_2'],
    modelId: 'stub-week1',
    promptVersion: 'v0.0.0-stub',
    source: 'fallback',
    draftContent: makeContent(),
    currentContent: makeContent(),
    committedContent: null,
    createdById: 'u_1',
    committedById: null,
    committedAt: null,
    editHistory: [],
    createdAt: new Date('2026-05-26T10:00:00.000Z'),
    updatedAt: new Date('2026-05-26T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantContext.mockResolvedValue({
    tenantId: 't_1',
    userRole: 'admin',
    tenantRole: 'tenant_admin',
  });
  // Default $transaction implementation: call the callback with the mock client.
  mockPrisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof mockPrisma) => unknown)(mockPrisma);
    }
    return cb;
  });
});

describe('createDailyLogSummaryDraft', () => {
  it('creates a fresh artifact + summary row when none exist for {home, date}', async () => {
    mockPrisma.home.findFirst.mockResolvedValue({ id: 'h_1' });
    mockPrisma.dailyLogSummary.findUnique.mockResolvedValue(null);
    mockPrisma.generativeArtifact.create.mockResolvedValue(makeArtifactRow());
    mockPrisma.dailyLogSummary.create.mockResolvedValue({ id: 'dls_1' });

    const result = await createDailyLogSummaryDraft({
      actorUserId: 'u_1',
      homeId: 'h_1',
      date: '2026-05-26',
      regenerate: false,
      generated: {
        sourceRecordIds: ['task_1', 'task_2'],
        content: makeContent(),
        modelId: 'stub-week1',
        promptVersion: 'v0.0.0-stub',
        source: 'fallback',
      },
    });

    expect(result.id).toBe('art_1');
    expect(result.status).toBe('draft');
    expect(mockPrisma.generativeArtifact.create).toHaveBeenCalledOnce();
    expect(mockPrisma.dailyLogSummary.create).toHaveBeenCalledOnce();
    expect(mockPrisma.generativeArtifact.update).not.toHaveBeenCalled();
  });

  it('throws 409 SUMMARY_EXISTS when one exists and regenerate=false', async () => {
    mockPrisma.home.findFirst.mockResolvedValue({ id: 'h_1' });
    mockPrisma.dailyLogSummary.findUnique.mockResolvedValue({
      id: 'dls_1',
      artifactId: 'art_old',
      artifact: makeArtifactRow({ id: 'art_old' }),
    });

    await expect(
      createDailyLogSummaryDraft({
        actorUserId: 'u_1',
        homeId: 'h_1',
        date: '2026-05-26',
        regenerate: false,
        generated: {
          sourceRecordIds: [],
          content: makeContent(),
          modelId: 'stub',
          promptVersion: 'v0',
          source: 'fallback',
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SUMMARY_EXISTS' });
    expect(mockPrisma.generativeArtifact.create).not.toHaveBeenCalled();
  });

  it('supersedes the prior artifact when regenerate=true', async () => {
    mockPrisma.home.findFirst.mockResolvedValue({ id: 'h_1' });
    mockPrisma.dailyLogSummary.findUnique.mockResolvedValue({
      id: 'dls_1',
      artifactId: 'art_old',
      artifact: makeArtifactRow({ id: 'art_old' }),
    });
    mockPrisma.generativeArtifact.update.mockResolvedValue(
      makeArtifactRow({ id: 'art_old', status: 'superseded' }),
    );
    mockPrisma.generativeArtifact.create.mockResolvedValue(
      makeArtifactRow({ id: 'art_new' }),
    );
    mockPrisma.dailyLogSummary.update.mockResolvedValue({ id: 'dls_1' });

    const result = await createDailyLogSummaryDraft({
      actorUserId: 'u_1',
      homeId: 'h_1',
      date: '2026-05-26',
      regenerate: true,
      generated: {
        sourceRecordIds: ['task_new'],
        content: makeContent(),
        modelId: 'stub',
        promptVersion: 'v0',
        source: 'fallback',
      },
    });

    expect(result.id).toBe('art_new');
    expect(mockPrisma.generativeArtifact.update).toHaveBeenCalledWith({
      where: { id: 'art_old' },
      data: { status: 'superseded' },
    });
    expect(mockPrisma.generativeArtifact.create).toHaveBeenCalledOnce();
    expect(mockPrisma.dailyLogSummary.update).toHaveBeenCalledWith({
      where: { id: 'dls_1' },
      data: { artifactId: 'art_new' },
    });
  });

  it('throws 404 HOME_NOT_FOUND when home does not belong to the tenant', async () => {
    mockPrisma.home.findFirst.mockResolvedValue(null);

    await expect(
      createDailyLogSummaryDraft({
        actorUserId: 'u_1',
        homeId: 'h_other',
        date: '2026-05-26',
        regenerate: false,
        generated: {
          sourceRecordIds: [],
          content: makeContent(),
          modelId: 'stub',
          promptVersion: 'v0',
          source: 'fallback',
        },
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'HOME_NOT_FOUND' });
  });
});

describe('getArtifact', () => {
  it('returns the mapped artifact when found in tenant', async () => {
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(makeArtifactRow());
    const result = await getArtifact('u_1', 'art_1');
    expect(result.id).toBe('art_1');
    expect(result.createdAt).toBe('2026-05-26T10:00:00.000Z');
  });

  it('throws 404 ARTIFACT_NOT_FOUND when not in tenant', async () => {
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(null);
    await expect(getArtifact('u_1', 'art_x')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ARTIFACT_NOT_FOUND',
    });
  });
});

describe('editArtifact', () => {
  it('appends to editHistory and bumps status from draft to edited', async () => {
    const before = makeContent();
    const after = makeContent({ shiftHighlights: ['edited'] });
    const row = makeArtifactRow({ currentContent: before });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    mockPrisma.generativeArtifact.update.mockImplementation(async ({ data }) =>
      makeArtifactRow({
        status: 'edited',
        currentContent: data.currentContent,
        editHistory: data.editHistory,
      }),
    );

    const result = await editArtifact({
      actorUserId: 'u_2',
      artifactId: 'art_1',
      newContent: after,
      expectedUpdatedAt: row.updatedAt.toISOString(),
    });

    expect(result.status).toBe('edited');
    const history = result.editHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      byUserId: 'u_2',
      before,
      after,
    });
  });

  it('keeps status as edited (not draft) on second edit', async () => {
    const row = makeArtifactRow({
      status: 'edited',
      editHistory: [{ atIso: '2026-05-26T10:01:00Z', byUserId: 'u_2', before: makeContent(), after: makeContent() }],
    });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    mockPrisma.generativeArtifact.update.mockImplementation(async ({ data }) =>
      makeArtifactRow({ status: data.status as string, currentContent: data.currentContent }),
    );

    const result = await editArtifact({
      actorUserId: 'u_2',
      artifactId: 'art_1',
      newContent: makeContent({ shiftHighlights: ['second edit'] }),
      expectedUpdatedAt: row.updatedAt.toISOString(),
    });

    expect(result.status).toBe('edited');
  });

  it('throws 409 STALE_CONTENT when expectedUpdatedAt mismatches', async () => {
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(makeArtifactRow());
    await expect(
      editArtifact({
        actorUserId: 'u_2',
        artifactId: 'art_1',
        newContent: makeContent(),
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_CONTENT' });
    expect(mockPrisma.generativeArtifact.update).not.toHaveBeenCalled();
  });

  it('throws 409 ALREADY_COMMITTED when artifact is committed', async () => {
    const row = makeArtifactRow({ status: 'committed' });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    await expect(
      editArtifact({
        actorUserId: 'u_2',
        artifactId: 'art_1',
        newContent: makeContent(),
        expectedUpdatedAt: row.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_COMMITTED' });
  });

  it('throws 409 ARTIFACT_SUPERSEDED when artifact has been replaced', async () => {
    const row = makeArtifactRow({ status: 'superseded' });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    await expect(
      editArtifact({
        actorUserId: 'u_2',
        artifactId: 'art_1',
        newContent: makeContent(),
        expectedUpdatedAt: row.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ARTIFACT_SUPERSEDED' });
  });
});

describe('commitArtifact', () => {
  it('locks the artifact, snapshots committedContent, writes audit log', async () => {
    const content = makeContent({ shiftHighlights: ['reviewed'] });
    const row = makeArtifactRow({ currentContent: content, status: 'edited' });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    mockPrisma.generativeArtifact.update.mockImplementation(async ({ data }) =>
      makeArtifactRow({
        status: 'committed',
        currentContent: content,
        committedContent: data.committedContent,
        committedById: data.committedById as string,
        committedAt: data.committedAt as Date,
      }),
    );

    const result = await commitArtifact({ actorUserId: 'u_admin', artifactId: 'art_1' });

    expect(result.status).toBe('committed');
    expect(result.committedById).toBe('u_admin');
    expect(result.committedContent).toEqual(content);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: 'generative_artifact_commit',
          entityId: 'art_1',
          metadata: expect.objectContaining({
            event: 'generative_artifact_committed',
            artifactType: 'daily_log_summary',
            modelId: 'stub-week1',
            promptVersion: 'v0.0.0-stub',
          }),
        }),
      }),
    );
  });

  it('is idempotent — returns the artifact unchanged when already committed', async () => {
    const row = makeArtifactRow({ status: 'committed', committedById: 'u_admin' });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);

    const result = await commitArtifact({ actorUserId: 'u_other', artifactId: 'art_1' });

    expect(result.status).toBe('committed');
    expect(result.committedById).toBe('u_admin'); // unchanged
    expect(mockPrisma.generativeArtifact.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws 409 ARTIFACT_SUPERSEDED when attempting to commit a superseded artifact', async () => {
    const row = makeArtifactRow({ status: 'superseded' });
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(row);
    await expect(
      commitArtifact({ actorUserId: 'u_admin', artifactId: 'art_1' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ARTIFACT_SUPERSEDED' });
  });

  it('throws 404 when artifact not in tenant', async () => {
    mockPrisma.generativeArtifact.findFirst.mockResolvedValue(null);
    await expect(
      commitArtifact({ actorUserId: 'u_admin', artifactId: 'art_x' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'ARTIFACT_NOT_FOUND' });
  });
});
