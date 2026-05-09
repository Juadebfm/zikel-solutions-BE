import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { PlatformJwtPayload, PlatformRole } from '../../types/index.js';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parseExpiryMs } from '../../lib/tokens.js';
import {
  setupPlatformTotp,
  verifyPlatformTotpSetup,
  disablePlatformMfa,
  platformHasMfa,
  countPlatformBackupCodesRemaining,
} from './admin-mfa.service.js';
import {
  verifyPlatformTotpAndLogin,
  verifyPlatformBackupAndLogin,
  finalizePlatformLoginAfterEnrollment,
} from './admin-auth.service.js';
import { verifyMfaEnrollmentToken } from '../../auth/mfa-enrollment-token.js';

const PLATFORM_COOKIE_NAME = env.AUTH_PLATFORM_COOKIE_NAME;
const PLATFORM_COOKIE_DOMAIN = env.AUTH_PLATFORM_COOKIE_DOMAIN;
const PLATFORM_COOKIE_PATH = env.AUTH_PLATFORM_COOKIE_PATH;
const PLATFORM_COOKIE_SECURE =
  env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
const ACCESS_TOKEN_EXPIRY_MS = parseExpiryMs(env.JWT_ACCESS_EXPIRY);

function signPlatformAccessToken(
  fastify: FastifyInstance,
  user: { id: string; email: string; role: PlatformRole },
  sessionId: string,
  mfaVerified: boolean,
): string {
  return fastify.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: sessionId,
    mfaVerified,
    aud: 'platform',
  });
}

function setPlatformRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(PLATFORM_COOKIE_NAME, token, {
    httpOnly: true,
    secure: PLATFORM_COOKIE_SECURE,
    sameSite: 'lax',
    path: PLATFORM_COOKIE_PATH,
    ...(PLATFORM_COOKIE_DOMAIN ? { domain: PLATFORM_COOKIE_DOMAIN } : {}),
    expires: expiresAt,
  });
}

function setNoStoreHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

const CodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be a 6-digit string.'),
});

const DisableSchema = z.object({
  currentPassword: z.string().min(1).max(256),
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

const adminMfaRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Public: platform MFA login challenge verify ───────────────────────────
  // Challenge token is the credential — these routes are not preceded by
  // fastify.authenticatePlatform.

  fastify.post('/totp/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Exchange platform challenge token + 6-digit TOTP code for a session',
      body: {
        type: 'object',
        required: ['challengeToken', 'code'],
        properties: {
          challengeToken: { type: 'string', minLength: 1 },
          code: { type: 'string', pattern: '^\\d{6}$' },
        },
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
      const ua = request.headers['user-agent'];
      const result = await verifyPlatformTotpAndLogin({
        challengeToken: parse.data.challengeToken,
        code: parse.data.code,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      const accessToken = signPlatformAccessToken(fastify, { id: result.user.id, email: result.user.email, role: result.user.role as PlatformRole }, result.session.id, true);
      setPlatformRefreshCookie(reply, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          user: result.user,
          tokens: {
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          },
        },
      });
    },
  });

  fastify.post('/backup/verify', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Exchange platform challenge token + single-use backup code for a session',
      body: {
        type: 'object',
        required: ['challengeToken', 'code'],
        properties: {
          challengeToken: { type: 'string', minLength: 1 },
          code: { type: 'string', minLength: 8, maxLength: 20 },
        },
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
      const ua = request.headers['user-agent'];
      const result = await verifyPlatformBackupAndLogin({
        challengeToken: parse.data.challengeToken,
        code: parse.data.code,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      const accessToken = signPlatformAccessToken(fastify, { id: result.user.id, email: result.user.email, role: result.user.role as PlatformRole }, result.session.id, true);
      setPlatformRefreshCookie(reply, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          user: result.user,
          tokens: {
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          },
        },
      });
    },
  });

  // ── Public: first-time enrollment (driven by /admin/auth/login) ──────────
  // Used when a platform user logs in with valid password but has no TOTP
  // credential. The login response handed back an enrollment token instead of
  // a session. These endpoints exchange that token for the QR + backup codes,
  // and ultimately a full session — all in one continuous flow.

  fastify.post('/totp/enroll/setup', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Begin first-time platform TOTP enrollment from a login enrollment token',
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
        409: { $ref: 'ApiError#' },
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
      const platformUserId = verifyMfaEnrollmentToken({
        token: parse.data.enrollmentToken,
        expectedAudience: 'platform',
      });
      if (await platformHasMfa(platformUserId)) {
        throw httpError(409, 'MFA_ALREADY_CONFIRMED', 'MFA is already enrolled. Please log in normally.');
      }
      const user = await prisma.platformUser.findUnique({
        where: { id: platformUserId },
        select: { email: true },
      });
      if (!user) throw httpError(404, 'USER_NOT_FOUND', 'Platform user not found.');
      const result = await setupPlatformTotp({ platformUserId, userEmail: user.email });
      return reply.send({ success: true, data: result });
    },
  });

  fastify.post('/totp/enroll/confirm', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Confirm first-time platform TOTP enrollment and mint a session',
      body: {
        type: 'object',
        required: ['enrollmentToken', 'code'],
        properties: {
          enrollmentToken: { type: 'string', minLength: 1 },
          code: { type: 'string', pattern: '^\\d{6}$' },
        },
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
      const platformUserId = verifyMfaEnrollmentToken({
        token: parse.data.enrollmentToken,
        expectedAudience: 'platform',
      });
      // Confirm the credential with the user's first code. Throws on bad code.
      await verifyPlatformTotpSetup({ platformUserId, code: parse.data.code });
      // Mint the session (mfaVerified=true).
      const ua = request.headers['user-agent'];
      const result = await finalizePlatformLoginAfterEnrollment({
        platformUserId,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      const accessToken = signPlatformAccessToken(
        fastify,
        { id: result.user.id, email: result.user.email, role: result.user.role as PlatformRole },
        result.session.id,
        true,
      );
      setPlatformRefreshCookie(reply, result.tokens.refreshToken, result.tokens.refreshTokenExpiresAt);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          user: result.user,
          tokens: {
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
            refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt.toISOString(),
          },
        },
      });
    },
  });

  // ── Authenticated: self-service platform MFA management ──────────────────
  await fastify.register(async (authed) => {
    authed.addHook('preHandler', fastify.authenticatePlatform);

  authed.get('/status', {
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Get current platform-user MFA status',
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
      const userId = (request.user as PlatformJwtPayload).sub;
      const enabled = await platformHasMfa(userId);
      const backupCodesRemaining = enabled ? await countPlatformBackupCodesRemaining(userId) : 0;
      return reply.send({ success: true, data: { enabled, backupCodesRemaining } });
    },
  });

  authed.post('/totp/setup', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Begin TOTP enrollment for the platform user',
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
      const platformUserId = (request.user as PlatformJwtPayload).sub;
      const user = await prisma.platformUser.findUnique({
        where: { id: platformUserId },
        select: { email: true },
      });
      if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
      const result = await setupPlatformTotp({ platformUserId, userEmail: user.email });
      return reply.send({ success: true, data: result });
    },
  });

  authed.post('/totp/verify-setup', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Confirm platform TOTP enrollment with the first code',
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
      const platformUserId = (request.user as PlatformJwtPayload).sub;
      const result = await verifyPlatformTotpSetup({ platformUserId, code: parse.data.code });
      return reply.send({ success: true, data: result });
    },
  });

  authed.delete('/totp', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Admin Auth — MFA'],
      summary: 'Disable platform TOTP — requires current password',
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
      const platformUserId = (request.user as PlatformJwtPayload).sub;
      const result = await disablePlatformMfa({
        platformUserId,
        currentPassword: parse.data.currentPassword,
      });
      return reply.send({ success: true, data: result });
    },
  });
  });
};

export default adminMfaRoutes;
