import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../types/index.js';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  setupTenantTotp,
  verifyTenantTotpSetup,
  disableTenantMfa,
  tenantHasMfa,
  countTenantBackupCodesRemaining,
} from './mfa.service.js';
import {
  verifyTenantTotpAndLogin,
  verifyTenantBackupAndLogin,
  finalizeTenantLoginAfterEnrollment,
} from './auth.service.js';
import {
  signTenantAccessToken,
  setNoStoreHeaders,
  setTenantRefreshCookie,
  buildTimedAuthResponse,
} from './auth.helpers.js';
import { verifyMfaEnrollmentToken } from '../../auth/mfa-enrollment-token.js';

const CodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be a 6-digit string.'),
});

const VerifyChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Code must be a 6-digit string.'),
});

const BackupChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(8).max(20),
});

const EnrollmentSetupSchema = z.object({
  enrollmentToken: z.string().min(1),
});

const EnrollmentConfirmSchema = z.object({
  enrollmentToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Code must be a 6-digit string.'),
});

const DisableSchema = z.object({
  currentPassword: z.string().min(1).max(256),
});

const mfaRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Public: MFA login challenge verify ────────────────────────────────────
  // Challenge token is the credential — these routes are not preceded by
  // fastify.authenticate. The token's signature is verified inside the service.

  fastify.post('/totp/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth — MFA'],
      summary: 'Exchange MFA challenge token + 6-digit TOTP code for a full session',
      body: {
        type: 'object',
        required: ['challengeToken', 'code'],
        properties: {
          challengeToken: { type: 'string', minLength: 1 },
          code: { type: 'string', pattern: '^\\d{6}$' },
        },
      },
      response: {
        200: { $ref: 'AuthResponse#' },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const parse = VerifyChallengeSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await verifyTenantTotpAndLogin(parse.data);
      const accessToken = signTenantAccessToken(fastify, result.user, { ...result.session, mfaVerified: true }, result.sessionId);
      setNoStoreHeaders(reply);
      setTenantRefreshCookie(reply, result.refreshToken, result.sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user: result.user,
          session: { ...result.session, mfaVerified: true },
          sessionExpiry: result.sessionExpiry,
          accessToken,
          refreshToken: result.refreshToken,
        }),
      });
    },
  });

  fastify.post('/backup/verify', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Auth — MFA'],
      summary: 'Exchange MFA challenge token + single-use backup code for a full session',
      body: {
        type: 'object',
        required: ['challengeToken', 'code'],
        properties: {
          challengeToken: { type: 'string', minLength: 1 },
          code: { type: 'string', minLength: 8, maxLength: 20 },
        },
      },
      response: {
        200: { $ref: 'AuthResponse#' },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const parse = BackupChallengeSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await verifyTenantBackupAndLogin(parse.data);
      const accessToken = signTenantAccessToken(fastify, result.user, { ...result.session, mfaVerified: true }, result.sessionId);
      setNoStoreHeaders(reply);
      setTenantRefreshCookie(reply, result.refreshToken, result.sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user: result.user,
          session: { ...result.session, mfaVerified: true },
          sessionExpiry: result.sessionExpiry,
          accessToken,
          refreshToken: result.refreshToken,
        }),
      });
    },
  });

  // ── Public: first-time enrollment (driven by /auth/login enrollmentToken) ──
  // Used when a privileged user (Owner) logs in with valid password but has
  // not yet enrolled TOTP. The login response handed back an enrollment token
  // instead of a session. These endpoints exchange that token for the QR code,
  // backup codes, and ultimately a full session — all in one flow.

  fastify.post('/totp/enroll/setup', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth — MFA'],
      summary: 'Begin first-time TOTP enrollment from a login enrollment token',
      body: {
        type: 'object',
        required: ['enrollmentToken'],
        properties: { enrollmentToken: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['qrCodeDataUri', 'otpAuthUri', 'backupCodes'],
              properties: {
                qrCodeDataUri: { type: 'string' },
                otpAuthUri: { type: 'string' },
                backupCodes: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const parse = EnrollmentSetupSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = verifyMfaEnrollmentToken({
        token: parse.data.enrollmentToken,
        expectedAudience: 'tenant',
      });
      // If the user already has a confirmed credential (e.g. enrolled from
      // another device while this enrollment token was outstanding), refuse
      // — the enrollment-token flow is reserved for first-time setup.
      if (await tenantHasMfa(userId)) {
        throw httpError(409, 'MFA_ALREADY_CONFIRMED', 'MFA is already enrolled. Please log in normally.');
      }
      const user = await prisma.tenantUser.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
      const result = await setupTenantTotp({ userId, userEmail: user.email });
      return reply.send({ success: true, data: result });
    },
  });

  fastify.post('/totp/enroll/confirm', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth — MFA'],
      summary: 'Confirm first-time TOTP enrollment and mint a full session',
      body: {
        type: 'object',
        required: ['enrollmentToken', 'code'],
        properties: {
          enrollmentToken: { type: 'string', minLength: 1 },
          code: { type: 'string', pattern: '^\\d{6}$' },
        },
      },
      response: {
        200: { $ref: 'AuthResponse#' },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const parse = EnrollmentConfirmSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = verifyMfaEnrollmentToken({
        token: parse.data.enrollmentToken,
        expectedAudience: 'tenant',
      });
      // Mark the credential confirmed. Throws on bad code / no setup.
      await verifyTenantTotpSetup({ userId, code: parse.data.code });
      // Mint the session — same shape as a full login response.
      const result = await finalizeTenantLoginAfterEnrollment(userId);
      const accessToken = signTenantAccessToken(
        fastify,
        result.user,
        { ...result.session, mfaVerified: true },
        result.sessionId,
      );
      setNoStoreHeaders(reply);
      setTenantRefreshCookie(reply, result.refreshToken, result.sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user: result.user,
          session: { ...result.session, mfaVerified: true },
          sessionExpiry: result.sessionExpiry,
          accessToken,
          refreshToken: result.refreshToken,
        }),
      });
    },
  });

  // ── Authenticated: self-service MFA management ────────────────────────────
  await fastify.register(async (authed) => {
    authed.addHook('preHandler', fastify.authenticate);

    authed.get('/status', {
      schema: {
        tags: ['Auth — MFA'],
        summary: 'Get current MFA status for the authenticated user',
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['enabled', 'backupCodesRemaining'],
                properties: {
                  enabled: { type: 'boolean' },
                  backupCodesRemaining: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      handler: async (request, reply) => {
        const userId = (request.user as JwtPayload).sub;
        const enabled = await tenantHasMfa(userId);
        const backupCodesRemaining = enabled ? await countTenantBackupCodesRemaining(userId) : 0;
        return reply.send({ success: true, data: { enabled, backupCodesRemaining } });
      },
    });

    authed.post('/totp/setup', {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth — MFA'],
        summary: 'Begin TOTP enrollment — returns QR + backup codes',
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['qrCodeDataUri', 'otpAuthUri', 'backupCodes'],
                properties: {
                  qrCodeDataUri: { type: 'string' },
                  otpAuthUri: { type: 'string' },
                  backupCodes: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          404: { $ref: 'ApiError#' },
        },
      },
      handler: async (request, reply) => {
        const userId = (request.user as JwtPayload).sub;
        const user = await prisma.tenantUser.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
        const result = await setupTenantTotp({ userId, userEmail: user.email });
        return reply.send({ success: true, data: result });
      },
    });

    authed.post('/totp/verify-setup', {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['Auth — MFA'],
        summary: 'Confirm TOTP enrollment with the first 6-digit code',
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', pattern: '^\\d{6}$' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object', properties: { enrolled: { type: 'boolean' } } },
            },
          },
          401: { $ref: 'ApiError#' },
          404: { $ref: 'ApiError#' },
          409: { $ref: 'ApiError#' },
          422: { $ref: 'ApiError#' },
        },
      },
      handler: async (request, reply) => {
        const parse = CodeSchema.safeParse(request.body);
        if (!parse.success) {
          return reply.status(422).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
          });
        }
        const userId = (request.user as JwtPayload).sub;
        const result = await verifyTenantTotpSetup({ userId, code: parse.data.code });
        return reply.send({ success: true, data: result });
      },
    });

    authed.delete('/totp', {
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
      schema: {
        tags: ['Auth — MFA'],
        summary: 'Disable TOTP — requires current password',
        body: {
          type: 'object',
          required: ['currentPassword'],
          properties: { currentPassword: { type: 'string', minLength: 1 } },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object', properties: { disabled: { type: 'boolean' } } },
            },
          },
          401: { $ref: 'ApiError#' },
          422: { $ref: 'ApiError#' },
        },
      },
      handler: async (request, reply) => {
        const parse = DisableSchema.safeParse(request.body);
        if (!parse.success) {
          return reply.status(422).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
          });
        }
        const userId = (request.user as JwtPayload).sub;
        const result = await disableTenantMfa({ userId, currentPassword: parse.data.currentPassword });
        return reply.send({ success: true, data: result });
      },
    });
  });
};

export default mfaRoutes;
