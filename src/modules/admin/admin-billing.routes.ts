/**
 * Phase 7.8 — `/admin/billing/*` admin surface for Zikel staff.
 *
 *   GET  /admin/billing/subscriptions             — list across all tenants
 *   GET  /admin/billing/subscriptions/:tenantId   — detail (subscription + invoices + payment methods + allocation)
 *   POST /admin/billing/subscriptions/:tenantId/override  — support escalation
 *   GET  /admin/billing/events                    — BillingEvent log (ops debugging)
 *
 * All routes: `fastify.authenticatePlatform` + `requirePlatformMfa`. Override
 * is additionally restricted to `platform_admin` role.
 */

import type { FastifyPluginAsync } from 'fastify';
import { BillingEventKind } from '@prisma/client';
import { z } from 'zod';
import type { PlatformJwtPayload } from '../../types/index.js';
import { requirePlatformMfa } from '../../middleware/mfa.js';
import { requirePlatformRole } from '../../middleware/platform-rbac.js';
import * as adminBilling from './admin-billing.service.js';

const ListSubscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z
    .enum([
      'trialing',
      'active',
      'past_due_grace',
      'past_due_readonly',
      'suspended',
      'cancelled',
      'incomplete',
    ])
    .optional(),
  search: z.string().min(1).max(120).optional(),
});

const OverrideBodySchema = z.object({
  extendTrialDays: z.number().int().min(1).max(365).optional(),
  grantFullAccessUntil: z.coerce.date().optional(),
  addBonusCalls: z.number().int().min(1).max(100_000).optional(),
  reason: z.string().min(10).max(500),
}).refine(
  (b) =>
    b.extendTrialDays !== undefined ||
    b.grantFullAccessUntil !== undefined ||
    b.addBonusCalls !== undefined,
  { message: 'At least one of extendTrialDays, grantFullAccessUntil, or addBonusCalls must be provided.' },
);

const ListEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  tenantId: z.string().min(1).optional(),
  kind: z.nativeEnum(BillingEventKind).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

const adminBillingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticatePlatform);
  fastify.addHook('preHandler', requirePlatformMfa);

  // ── GET /admin/billing/subscriptions — list ──────────────────────────────
  fastify.get('/subscriptions', {
    schema: {
      tags: ['Admin Billing'],
      summary: 'List subscriptions across all tenants (filterable + searchable)',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          status: {
            type: 'string',
            enum: [
              'trialing',
              'active',
              'past_due_grace',
              'past_due_readonly',
              'suspended',
              'cancelled',
              'incomplete',
            ],
          },
          search: { type: 'string', minLength: 1, maxLength: 120 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListSubscriptionsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await adminBilling.listSubscriptionsForPlatform({
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        ...(parse.data.status ? { status: parse.data.status } : {}),
        ...(parse.data.search ? { search: parse.data.search } : {}),
      });
      return reply.send({ success: true, ...result });
    },
  });

  // ── GET /admin/billing/subscriptions/:tenantId — detail ──────────────────
  fastify.get<{ Params: { tenantId: string } }>('/subscriptions/:tenantId', {
    schema: {
      tags: ['Admin Billing'],
      summary: 'Tenant subscription detail (subscription + recent invoices + payment methods + current allocation)',
      params: {
        type: 'object',
        required: ['tenantId'],
        properties: { tenantId: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const data = await adminBilling.getSubscriptionDetailForPlatform({
        tenantId: request.params.tenantId,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /admin/billing/subscriptions/:tenantId/override — escalation ────
  fastify.post<{ Params: { tenantId: string } }>('/subscriptions/:tenantId/override', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    preHandler: [requirePlatformRole('platform_admin')],
    schema: {
      tags: ['Admin Billing'],
      summary: 'Manual subscription override (platform_admin only)',
      description:
        'Used by Zikel staff to extend a trial, grant full-access until a date (bypasses past-due gate), or credit bonus AI calls during support escalations. Logged in BillingEvent + PlatformAuditLog.',
      params: {
        type: 'object',
        required: ['tenantId'],
        properties: { tenantId: { type: 'string', minLength: 1 } },
      },
      // Validation handled by Zod (AJV `removeAdditional: 'all'` strips
      // out-of-range numbers silently).
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = OverrideBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const data = await adminBilling.applySubscriptionOverride({
        platformUserId: platformUser.sub,
        tenantId: request.params.tenantId,
        reason: parse.data.reason,
        ...(parse.data.extendTrialDays !== undefined ? { extendTrialDays: parse.data.extendTrialDays } : {}),
        ...(parse.data.grantFullAccessUntil !== undefined ? { grantFullAccessUntil: parse.data.grantFullAccessUntil } : {}),
        ...(parse.data.addBonusCalls !== undefined ? { addBonusCalls: parse.data.addBonusCalls } : {}),
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      return reply.send({ success: true, data });
    },
  });

  // ── GET /admin/billing/events — BillingEvent log ─────────────────────────
  fastify.get('/events', {
    schema: {
      tags: ['Admin Billing'],
      summary: 'List BillingEvent rows (ops debugging — webhook history, manual overrides, etc.)',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          tenantId: { type: 'string' },
          kind: { type: 'string' },
          fromDate: { type: 'string', format: 'date-time' },
          toDate: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListEventsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await adminBilling.listBillingEvents({
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        ...(parse.data.tenantId ? { tenantId: parse.data.tenantId } : {}),
        ...(parse.data.kind ? { kind: parse.data.kind } : {}),
        ...(parse.data.fromDate ? { fromDate: parse.data.fromDate } : {}),
        ...(parse.data.toDate ? { toDate: parse.data.toDate } : {}),
      });
      return reply.send({ success: true, ...result });
    },
  });
};

export default adminBillingRoutes;
