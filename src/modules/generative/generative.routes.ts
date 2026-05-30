/**
 * `/api/v1/generative/*` — AI-produced artifact lifecycle.
 *
 * Phase 1 (this file's Week 1 wiring): daily-log summarisation with a
 * hardcoded draft. Week 2 replaces the hardcoded content with a real AI call.
 *
 * Auth: every route requires `fastify.authenticate`. We do NOT gate behind
 * privileged MFA the way billing does — generative create/edit/commit are
 * day-to-day staff operations, not money movements.
 *
 * Permission gates:
 *   POST /daily-log-summary       — GENERATIVE_CREATE
 *   GET  /artifacts/:id           — GENERATIVE_CREATE (read access flows with creators)
 *   PATCH /artifacts/:id          — GENERATIVE_CREATE
 *   POST /artifacts/:id/commit    — GENERATIVE_COMMIT
 */

import type { FastifyPluginAsync } from 'fastify';
import { Permissions as P } from '../../auth/permissions.js';
import { requirePermission } from '../../middleware/rbac.js';
import type { JwtPayload } from '../../types/index.js';
import { httpError, sendValidationError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import * as generative from './generative.service.js';
import { generateDailyLogSummary } from './daily-log-summary.generator.js';
import { debitForSummary, requireSummaryQuotaAvailable } from './quota.js';
import {
  ArtifactIdParamSchema,
  CreateDailyLogSummaryBodySchema,
  EditArtifactBodySchema,
  ListArtifactsQuerySchema,
  LookupDailyLogSummaryQuerySchema,
  createDailyLogSummaryBodyJson,
  editArtifactBodyJson,
  listArtifactsQueryJson,
  lookupDailyLogSummaryQueryJson,
} from './generative.schema.js';

// ─── Routes ─────────────────────────────────────────────────────────────────

const generativeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── POST /api/v1/generative/daily-log-summary ────────────────────────────
  fastify.post('/daily-log-summary', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.GENERATIVE_CREATE)],
    schema: {
      tags: ['Generative'],
      summary: 'Generate a draft daily-log summary for {home, date}',
      body: createDailyLogSummaryBodyJson,
      response: {
        200: artifactEnvelopeJson,
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateDailyLogSummaryBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const userId = (request.user as JwtPayload).sub;
      const tenant = await requireTenantContext(userId);

      // Pre-flight quota gate. Throws 402 with a code the FE can route on
      // (AI_QUOTA_EXHAUSTED -> top-up CTA, SUMMARIES_QUOTA_EXHAUSTED -> upgrade).
      // We check BEFORE the model call to avoid wasting tokens on a request
      // we'd then refuse to persist.
      const quota = await requireSummaryQuotaAvailable(tenant.tenantId);

      const result = await generateDailyLogSummary({
        tenantId: tenant.tenantId,
        homeId: parse.data.homeId,
        date: parse.data.date,
      });
      if ('noSourceRecords' in result) {
        throw httpError(
          404,
          'NO_SOURCE_RECORDS',
          'No daily logs were recorded for this home and date — nothing to summarise.',
        );
      }

      const artifact = await generative.createDailyLogSummaryDraft({
        actorUserId: userId,
        homeId: parse.data.homeId,
        date: parse.data.date,
        regenerate: parse.data.regenerate,
        generated: result,
      });

      // Debit only after the artifact is durably persisted. If generation
      // succeeded but persistence threw, we don't charge the tenant for a
      // summary they never received. The shared pool debit is 25x a chat call
      // to reflect actual token consumption.
      await debitForSummary({
        tenantId: tenant.tenantId,
        userId,
        allocationId: quota.allocationId,
        artifactId: artifact.id,
      });

      return reply.send({ success: true, data: { artifact } });
    },
  });

  // ── GET /api/v1/generative/artifacts ─────────────────────────────────────
  // Paginated list. Used by the FE to render "all summaries for this home",
  // "all my drafts", "all committed summaries in date range", etc.
  fastify.get('/artifacts', {
    preHandler: [requirePermission(P.GENERATIVE_CREATE)],
    schema: {
      tags: ['Generative'],
      summary: 'List generative artifacts (tenant-scoped, filterable, paginated)',
      querystring: listArtifactsQueryJson,
      response: {
        200: artifactListEnvelopeJson,
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListArtifactsQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const { data, meta } = await generative.listArtifacts(userId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  // ── GET /api/v1/generative/daily-log-summary?homeId&date ─────────────────
  // Lookup-by-target. Answers "is there an active summary for {home, date}?"
  // without first listing then filtering client-side. Returns the current
  // active artifact (the one DailyLogSummary points at) or 404 SUMMARY_NOT_FOUND.
  fastify.get('/daily-log-summary', {
    preHandler: [requirePermission(P.GENERATIVE_CREATE)],
    schema: {
      tags: ['Generative'],
      summary: 'Look up the active daily-log summary for {homeId, date}',
      querystring: lookupDailyLogSummaryQueryJson,
      response: {
        200: artifactEnvelopeJson,
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = LookupDailyLogSummaryQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const artifact = await generative.getDailyLogSummaryByTarget({
        actorUserId: userId,
        homeId: parse.data.homeId,
        date: parse.data.date,
      });
      return reply.send({ success: true, data: { artifact } });
    },
  });

  // ── GET /api/v1/generative/artifacts/:id ─────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/artifacts/:id', {
    preHandler: [requirePermission(P.GENERATIVE_CREATE)],
    schema: {
      tags: ['Generative'],
      summary: 'Fetch a single generative artifact (draft, edited, committed, or superseded)',
      params: cuidParamJson,
      response: {
        200: artifactEnvelopeJson,
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ArtifactIdParamSchema.safeParse(request.params);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const artifact = await generative.getArtifact(userId, parse.data.id);
      return reply.send({ success: true, data: { artifact } });
    },
  });

  // ── PATCH /api/v1/generative/artifacts/:id ───────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/artifacts/:id', {
    config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.GENERATIVE_CREATE)],
    schema: {
      tags: ['Generative'],
      summary: 'Edit a draft artifact\'s currentContent (records the diff in editHistory)',
      params: cuidParamJson,
      body: editArtifactBodyJson,
      response: {
        200: artifactEnvelopeJson,
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const paramParse = ArtifactIdParamSchema.safeParse(request.params);
      if (!paramParse.success) return sendValidationError(reply, paramParse.error);
      const bodyParse = EditArtifactBodySchema.safeParse(request.body);
      if (!bodyParse.success) return sendValidationError(reply, bodyParse.error);

      const userId = (request.user as JwtPayload).sub;
      const artifact = await generative.editArtifact({
        actorUserId: userId,
        artifactId: paramParse.data.id,
        newContent: bodyParse.data.currentContent,
        expectedUpdatedAt: bodyParse.data.expectedUpdatedAt,
      });
      return reply.send({ success: true, data: { artifact } });
    },
  });

  // ── POST /api/v1/generative/artifacts/:id/commit ─────────────────────────
  fastify.post<{ Params: { id: string } }>('/artifacts/:id/commit', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.GENERATIVE_COMMIT)],
    schema: {
      tags: ['Generative'],
      summary: 'Finalise (lock) an artifact. Writes an audit log row. Idempotent.',
      params: cuidParamJson,
      response: {
        200: artifactEnvelopeJson,
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ArtifactIdParamSchema.safeParse(request.params);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const artifact = await generative.commitArtifact({
        actorUserId: userId,
        artifactId: parse.data.id,
      });
      return reply.send({ success: true, data: { artifact } });
    },
  });
};

// ─── Local JSON-schema fragments ────────────────────────────────────────────

const cuidParamJson = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

// Response envelope shared by every route in this module. Loose on the
// artifact shape (additionalProperties: true) because we want server-driven
// expansion without re-deploying — the artifact already validates at the
// service layer.
// Response envelopes — bind to the canonical GenerativeArtifact schema
// registered in src/openapi/shared.schemas.ts so Swagger docs and any future
// FE TypeScript codegen see one consistent shape.
const artifactEnvelopeJson = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['artifact'],
      properties: {
        artifact: { $ref: 'GenerativeArtifact#' },
      },
    },
  },
} as const;

const artifactListEnvelopeJson = {
  type: 'object',
  required: ['success', 'data', 'meta'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'array',
      items: { $ref: 'GenerativeArtifact#' },
    },
    meta: { $ref: 'PaginationMeta#' },
  },
} as const;

export default generativeRoutes;
