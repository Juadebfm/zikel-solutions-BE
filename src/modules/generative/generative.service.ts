/**
 * Generative artifact lifecycle.
 *
 * Implements draft -> edit -> commit for AI-produced artifacts. Phase 1 hosts
 * daily-log summaries; Phase 2+ will add Reg 44/45 reports and other types.
 *
 * Key invariants enforced here:
 *   1. Only the artifact's tenant can see/edit/commit it (tenant-scoped queries).
 *   2. Once committed, the artifact is immutable — edits return 409 ALREADY_COMMITTED.
 *   3. Edits use optimistic concurrency (`expectedUpdatedAt`) so concurrent
 *      writers don't silently lose each other's work.
 *   4. Every edit is appended to `editHistory` — never overwritten. This is
 *      the Ofsted-defensible "show me how this summary changed" trail.
 *   5. Source-record IDs are baked in at draft time and never re-derived.
 *      An auditor must be able to trace a committed summary back to the
 *      EXACT Task rows it was generated from.
 *
 * Week 1 (this file) leaves the AI call out — `createDailyLogSummaryDraft`
 * takes pre-computed content. Week 2 wires the prompt + model call.
 */

import { AuditAction, GenerativeArtifactStatus, GenerativeArtifactType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { DailyLogSummaryContent } from './generative.schema.js';

// ─── Mapping ────────────────────────────────────────────────────────────────

interface ArtifactRow {
  id: string;
  tenantId: string;
  artifactType: GenerativeArtifactType;
  status: GenerativeArtifactStatus;
  entityType: string;
  entityId: string;
  sourceRecordIds: Prisma.JsonValue;
  modelId: string;
  promptVersion: string;
  source: string;
  draftContent: Prisma.JsonValue;
  currentContent: Prisma.JsonValue;
  committedContent: Prisma.JsonValue | null;
  createdById: string;
  committedById: string | null;
  committedAt: Date | null;
  editHistory: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

function mapArtifact(row: ArtifactRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    artifactType: row.artifactType,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    sourceRecordIds: row.sourceRecordIds,
    modelId: row.modelId,
    promptVersion: row.promptVersion,
    source: row.source,
    draftContent: row.draftContent,
    currentContent: row.currentContent,
    committedContent: row.committedContent,
    createdById: row.createdById,
    committedById: row.committedById,
    committedAt: row.committedAt ? row.committedAt.toISOString() : null,
    editHistory: row.editHistory,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Create (draft) ─────────────────────────────────────────────────────────

interface CreateDailyLogSummaryDraftArgs {
  actorUserId: string;
  homeId: string;
  date: string;        // YYYY-MM-DD
  regenerate: boolean;
  // Generation result (Week 2 will compute this; Week 1 callers pass a stub).
  generated: {
    sourceRecordIds: string[];
    content: DailyLogSummaryContent;
    modelId: string;
    promptVersion: string;
    source: 'model' | 'fallback';
  };
}

/**
 * Create a draft daily-log summary. The caller is responsible for the
 * AI generation step (Week 2 will move that into a sibling helper called
 * before this function).
 *
 * Returns the newly-created artifact. Throws 409 SUMMARY_EXISTS if a summary
 * already exists for {tenant, home, date} unless `regenerate: true`, in
 * which case the prior artifact is marked `superseded`.
 */
export async function createDailyLogSummaryDraft(args: CreateDailyLogSummaryDraftArgs) {
  const tenant = await requireTenantContext(args.actorUserId);

  // Verify the home belongs to this tenant. Tenant-scope client extension
  // would catch it, but an explicit 404 is cleaner than a silent null.
  const home = await prisma.home.findFirst({
    where: { id: args.homeId, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found in this tenant.');
  }

  const summaryDate = parseSummaryDate(args.date);

  // Look for an existing summary for this {tenant, home, date}.
  const existing = await prisma.dailyLogSummary.findUnique({
    where: {
      tenantId_homeId_summaryDate: {
        tenantId: tenant.tenantId,
        homeId: args.homeId,
        summaryDate,
      },
    },
    include: { artifact: true },
  });

  if (existing) {
    if (!args.regenerate) {
      throw httpError(
        409,
        'SUMMARY_EXISTS',
        'A summary already exists for this home and date. Pass regenerate: true to replace it.',
      );
    }
    // Supersede: mark the old artifact, then create the new one and re-point
    // the DailyLogSummary at it. Done in a single transaction so we never
    // leave a dangling pointer.
    return prisma.$transaction(async (tx) => {
      await tx.generativeArtifact.update({
        where: { id: existing.artifactId },
        data: { status: GenerativeArtifactStatus.superseded },
      });
      const created = await tx.generativeArtifact.create({
        data: {
          tenantId: tenant.tenantId,
          artifactType: GenerativeArtifactType.daily_log_summary,
          status: GenerativeArtifactStatus.draft,
          entityType: 'home',
          entityId: args.homeId,
          sourceRecordIds: args.generated.sourceRecordIds,
          modelId: args.generated.modelId,
          promptVersion: args.generated.promptVersion,
          source: args.generated.source,
          draftContent: args.generated.content as unknown as Prisma.InputJsonValue,
          currentContent: args.generated.content as unknown as Prisma.InputJsonValue,
          createdById: args.actorUserId,
          editHistory: [],
        },
      });
      await tx.dailyLogSummary.update({
        where: { id: existing.id },
        data: { artifactId: created.id },
      });
      return mapArtifact(created);
    });
  }

  // Fresh create — no prior summary for this {home, date}.
  return prisma.$transaction(async (tx) => {
    const created = await tx.generativeArtifact.create({
      data: {
        tenantId: tenant.tenantId,
        artifactType: GenerativeArtifactType.daily_log_summary,
        status: GenerativeArtifactStatus.draft,
        entityType: 'home',
        entityId: args.homeId,
        sourceRecordIds: args.generated.sourceRecordIds,
        modelId: args.generated.modelId,
        promptVersion: args.generated.promptVersion,
        source: args.generated.source,
        draftContent: args.generated.content as unknown as Prisma.InputJsonValue,
        currentContent: args.generated.content as unknown as Prisma.InputJsonValue,
        createdById: args.actorUserId,
        editHistory: [],
      },
    });
    await tx.dailyLogSummary.create({
      data: {
        tenantId: tenant.tenantId,
        homeId: args.homeId,
        summaryDate,
        artifactId: created.id,
      },
    });
    return mapArtifact(created);
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getArtifact(actorUserId: string, artifactId: string) {
  const tenant = await requireTenantContext(actorUserId);
  const row = await prisma.generativeArtifact.findFirst({
    where: { id: artifactId, tenantId: tenant.tenantId },
  });
  if (!row) {
    throw httpError(404, 'ARTIFACT_NOT_FOUND', 'Generative artifact not found.');
  }
  return mapArtifact(row);
}

// ─── Edit (append to history) ───────────────────────────────────────────────

interface EditEntry {
  atIso: string;
  byUserId: string;
  before: DailyLogSummaryContent;
  after: DailyLogSummaryContent;
}

export async function editArtifact(args: {
  actorUserId: string;
  artifactId: string;
  newContent: DailyLogSummaryContent;
  expectedUpdatedAt: string;
}) {
  const tenant = await requireTenantContext(args.actorUserId);

  // Use a transaction with SELECT ... so the optimistic check is race-safe.
  return prisma.$transaction(async (tx) => {
    const current = await tx.generativeArtifact.findFirst({
      where: { id: args.artifactId, tenantId: tenant.tenantId },
    });
    if (!current) {
      throw httpError(404, 'ARTIFACT_NOT_FOUND', 'Generative artifact not found.');
    }
    if (current.status === GenerativeArtifactStatus.committed) {
      throw httpError(409, 'ALREADY_COMMITTED', 'This artifact has been committed and cannot be edited.');
    }
    if (current.status === GenerativeArtifactStatus.superseded) {
      throw httpError(409, 'ARTIFACT_SUPERSEDED', 'This artifact has been replaced by a newer regeneration.');
    }
    if (current.updatedAt.toISOString() !== args.expectedUpdatedAt) {
      throw httpError(
        409,
        'STALE_CONTENT',
        'The artifact has been modified since you loaded it. Refetch and reapply your edits.',
      );
    }

    const entry: EditEntry = {
      atIso: new Date().toISOString(),
      byUserId: args.actorUserId,
      before: current.currentContent as unknown as DailyLogSummaryContent,
      after: args.newContent,
    };
    const existingHistory = (current.editHistory ?? []) as unknown as EditEntry[];
    const nextHistory = [...existingHistory, entry];

    const updated = await tx.generativeArtifact.update({
      where: { id: current.id },
      data: {
        currentContent: args.newContent as unknown as Prisma.InputJsonValue,
        editHistory: nextHistory as unknown as Prisma.InputJsonValue,
        // Bump status to 'edited' from 'draft' so the FE can show a different
        // chip. Already-edited stays edited.
        status:
          current.status === GenerativeArtifactStatus.draft
            ? GenerativeArtifactStatus.edited
            : current.status,
      },
    });
    return mapArtifact(updated);
  });
}

// ─── Commit (lock + audit) ──────────────────────────────────────────────────

export async function commitArtifact(args: { actorUserId: string; artifactId: string }) {
  const tenant = await requireTenantContext(args.actorUserId);

  return prisma.$transaction(async (tx) => {
    const current = await tx.generativeArtifact.findFirst({
      where: { id: args.artifactId, tenantId: tenant.tenantId },
    });
    if (!current) {
      throw httpError(404, 'ARTIFACT_NOT_FOUND', 'Generative artifact not found.');
    }
    if (current.status === GenerativeArtifactStatus.committed) {
      // Idempotent: already committed -> return as-is.
      return mapArtifact(current);
    }
    if (current.status === GenerativeArtifactStatus.superseded) {
      throw httpError(409, 'ARTIFACT_SUPERSEDED', 'This artifact has been replaced by a newer regeneration.');
    }

    const updated = await tx.generativeArtifact.update({
      where: { id: current.id },
      data: {
        status: GenerativeArtifactStatus.committed,
        committedContent: current.currentContent as unknown as Prisma.InputJsonValue,
        committedById: args.actorUserId,
        committedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: args.actorUserId,
        action: AuditAction.record_created,
        entityType: 'generative_artifact_commit',
        entityId: current.id,
        metadata: {
          event: 'generative_artifact_committed',
          artifactType: current.artifactType,
          targetEntityType: current.entityType,
          targetEntityId: current.entityId,
          sourceRecordIds: current.sourceRecordIds,
          modelId: current.modelId,
          promptVersion: current.promptVersion,
        },
      },
    });

    logger.info({
      msg: 'Generative artifact committed',
      tenantId: tenant.tenantId,
      artifactId: current.id,
      artifactType: current.artifactType,
      committedById: args.actorUserId,
    });

    return mapArtifact(updated);
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseSummaryDate(yyyyMmDd: string): Date {
  // Parse as UTC midnight so a date string '2026-05-26' always maps to the
  // same DB row regardless of server timezone.
  const date = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw httpError(422, 'INVALID_DATE', `Invalid date: ${yyyyMmDd}`);
  }
  return date;
}
