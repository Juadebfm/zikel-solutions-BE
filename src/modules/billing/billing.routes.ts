/**
 * Phase 7.5 — `/api/v1/billing/*` — tenant-side billing surface.
 *
 * All routes: `fastify.authenticate` + `requirePrivilegedMfa`. Read paths
 * gated by `BILLING_READ` (Owner + Admin); write paths gated by
 * `BILLING_WRITE` (Owner only — see permissions.ts).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../types/index.js';
import { Permissions as P } from '../../auth/permissions.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as billing from './billing.service.js';
import { sendValidationError } from '../../lib/errors.js';

// ─── Body schemas ───────────────────────────────────────────────────────────

// Group is intentionally excluded — Group customers go through the contact-sales
// form, not Stripe Checkout. createSubscriptionCheckoutSession rejects 'group'
// explicitly if it ever slips through.
const CheckoutSessionBodySchema = z.object({
  planCode: z.enum(['single_home', 'multi_home']),
});

const TopUpCheckoutBodySchema = z.object({
  packCode: z.enum(['topup_small', 'topup_medium', 'topup_large']),
});

const ListInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Group tier lead-capture body. Email + name come from the authenticated user;
// the form just adds the context sales needs to triage. All fields optional —
// even a blank submission ("we're interested, please reach out") is valid.
const ContactSalesBodySchema = z
  .object({
    phone: z.string().trim().max(40).optional(),
    companyName: z.string().trim().max(200).optional(),
    estimatedHomes: z.number().int().min(1).max(10_000).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .strict();

// AI restrictions: caps are nullable integers, ≥ 0, ≤ 100k.
const CapValueSchema = z.union([z.null(), z.number().int().min(0).max(100_000)]);
const UpdateAiRestrictionsBodySchema = z
  .object({
    perRoleCaps: z.record(z.string(), CapValueSchema).optional(),
    perUserCaps: z.record(z.string(), CapValueSchema).optional(),
  })
  .refine((b) => b.perRoleCaps !== undefined || b.perUserCaps !== undefined, {
    message: 'At least one of `perRoleCaps` or `perUserCaps` must be provided.',
  });

// ─── Routes ─────────────────────────────────────────────────────────────────

const billingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  // ── GET /api/v1/billing/subscription ────────────────────────────────────
  fastify.get('/subscription', {
    preHandler: [requirePermission(P.BILLING_READ)],
    schema: {
      tags: ['Billing'],
      summary: "Current subscription state + UI flags (banners, days left in trial, etc.)",
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
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.getSubscriptionState(userId);
      return reply.send({ success: true, data });
    },
  });

  // ── GET /api/v1/billing/plans ───────────────────────────────────────────
  fastify.get('/plans', {
    preHandler: [requirePermission(P.BILLING_READ)],
    schema: {
      tags: ['Billing'],
      summary: 'List subscription tiers (Single Home, Multi-Home, Group) and the three top-up packs',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['plans', 'topUpPacks'],
              properties: {
                plans: { type: 'array', items: { type: 'object', additionalProperties: true } },
                topUpPacks: { type: 'array', items: { type: 'object', additionalProperties: true } },
              },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const data = await billing.listAvailablePlans();
      return reply.send({ success: true, data });
    },
  });

  // ── GET /api/v1/billing/quota ───────────────────────────────────────────
  fastify.get('/quota', {
    preHandler: [requirePermission(P.BILLING_READ)],
    schema: {
      tags: ['Billing'],
      summary: 'Current period AI quota usage (pool, top-ups, per-user breakdown, restrictions)',
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
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.getQuotaForTenant(userId);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/billing/checkout-session ───────────────────────────────
  fastify.post('/checkout-session', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Start a Stripe Checkout session to subscribe (or change plan)',
      body: {
        type: 'object',
        required: ['planCode'],
        properties: {
          planCode: { type: 'string', enum: ['single_home', 'multi_home'] },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: ['string', 'null'] },
                expiresAt: { type: ['string', 'null'] },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
        503: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CheckoutSessionBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.createSubscriptionCheckoutSession({
        actorUserId: userId,
        planCode: parse.data.planCode,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/billing/portal-session ─────────────────────────────────
  fastify.post('/portal-session', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Open the Stripe Customer Portal (manage card, change plan, cancel)',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['url'],
              properties: { url: { type: 'string' } },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        503: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.createPortalSession({ actorUserId: userId });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/billing/contact-sales ──────────────────────────────────
  // Group tier lead capture. Authenticated user's email + name come from the
  // JWT/DB; the body carries optional context (phone, company, est. homes,
  // free-text message). Routes the lead to sales@zikelsolutions.com via Resend
  // and writes an audit trail row. Tighter rate limit than other billing
  // routes — this is a low-frequency action and we don't want a runaway form.
  fastify.post('/contact-sales', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Submit a Group-plan sales enquiry (routes to sales@zikelsolutions.com)',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phone: { type: 'string', maxLength: 40 },
          companyName: { type: 'string', maxLength: 200 },
          estimatedHomes: { type: 'integer', minimum: 1, maximum: 10_000 },
          message: { type: 'string', maxLength: 2000 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['ok'],
              properties: { ok: { type: 'boolean', enum: [true] } },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ContactSalesBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const userId = (request.user as JwtPayload).sub;
      const data = await billing.submitContactSalesLead({
        actorUserId: userId,
        ...(parse.data.phone ? { phone: parse.data.phone } : {}),
        ...(parse.data.companyName ? { companyName: parse.data.companyName } : {}),
        ...(typeof parse.data.estimatedHomes === 'number'
          ? { estimatedHomes: parse.data.estimatedHomes }
          : {}),
        ...(parse.data.message ? { message: parse.data.message } : {}),
        ipAddress: request.ip,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/billing/topup-checkout-session ─────────────────────────
  fastify.post('/topup-checkout-session', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Start a Stripe Checkout session to buy an AI top-up pack',
      body: {
        type: 'object',
        required: ['packCode'],
        properties: {
          packCode: { type: 'string', enum: ['topup_small', 'topup_medium', 'topup_large'] },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: ['string', 'null'] },
                expiresAt: { type: ['string', 'null'] },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
        503: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = TopUpCheckoutBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.createTopUpCheckoutSession({
        actorUserId: userId,
        packCode: parse.data.packCode,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/billing/cancel ─────────────────────────────────────────
  fastify.post('/cancel', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Cancel the subscription at the end of the current period',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['cancelAtPeriodEnd'],
              properties: {
                cancelAtPeriodEnd: { type: 'boolean' },
                currentPeriodEnd: { type: ['string', 'null'], format: 'date-time' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        503: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.cancelSubscriptionAtPeriodEnd({ actorUserId: userId });
      return reply.send({ success: true, data });
    },
  });

  // ── GET /api/v1/billing/invoices ────────────────────────────────────────
  fastify.get('/invoices', {
    preHandler: [requirePermission(P.BILLING_READ)],
    schema: {
      tags: ['Billing'],
      summary: "Paginated invoice history (Stripe-hosted PDF + URL included)",
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
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
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListInvoicesQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const result = await billing.listInvoices({
        actorUserId: userId,
        page: parse.data.page,
        pageSize: parse.data.pageSize,
      });
      return reply.send({ success: true, ...result });
    },
  });

  // ── GET /api/v1/billing/ai-restrictions ─────────────────────────────────
  fastify.get('/ai-restrictions', {
    preHandler: [requirePermission(P.BILLING_READ)],
    schema: {
      tags: ['Billing'],
      summary: "Current per-role and per-user AI cap configuration",
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.getAiRestrictions({ actorUserId: userId });
      return reply.send({ success: true, data });
    },
  });

  // ── PUT /api/v1/billing/ai-restrictions ─────────────────────────────────
  fastify.put('/ai-restrictions', {
    preHandler: [requirePermission(P.BILLING_WRITE)],
    schema: {
      tags: ['Billing'],
      summary: 'Set per-role and per-user AI caps (Owner only)',
      // Body validation handled entirely by Zod in the handler. AJV's global
      // `removeAdditional: 'all'` aggressively strips object values that
      // don't match a precise schema — leaving us no way to write a permissive
      // body schema that still surfaces value-range failures. So we skip
      // route-level body validation here.
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateAiRestrictionsBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const userId = (request.user as JwtPayload).sub;
      const data = await billing.updateAiRestrictions({
        actorUserId: userId,
        body: {
          ...(parse.data.perRoleCaps !== undefined ? { perRoleCaps: parse.data.perRoleCaps } : {}),
          ...(parse.data.perUserCaps !== undefined ? { perUserCaps: parse.data.perUserCaps } : {}),
        },
      });
      return reply.send({ success: true, data });
    },
  });
};

export default billingRoutes;
