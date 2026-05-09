import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { httpError } from '../../lib/errors.js';
import { parseExpiryMs } from '../../lib/tokens.js';
import { refreshIdleExpiresAt, generateRefreshToken } from '../../lib/tokens.js';
import { prisma } from '../../lib/prisma.js';
import {
  loginPlatformUser,
  logoutPlatformUser,
  getPlatformUser,
  listPlatformSessions,
  revokePlatformSession,
  revokeAllPlatformSessions,
} from './admin-auth.service.js';
import type { PlatformJwtPayload, PlatformRole } from '../../types/index.js';

// ─── Zod schemas (route-level validation only — no exports for now) ───────────

const LoginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_COOKIE_DOMAIN = env.AUTH_PLATFORM_COOKIE_DOMAIN;
const PLATFORM_COOKIE_PATH = env.AUTH_PLATFORM_COOKIE_PATH;
const PLATFORM_COOKIE_SECURE =
  env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
// `__Host-` prefix REQUIRES Secure=true per RFC 6265bis. Strip it in
// dev/test where Secure is false; production keeps the prefix.
const PLATFORM_COOKIE_NAME = PLATFORM_COOKIE_SECURE
  ? env.AUTH_PLATFORM_COOKIE_NAME
  : env.AUTH_PLATFORM_COOKIE_NAME.replace(/^__Host-/, '');
const ACCESS_TOKEN_EXPIRY_MS = parseExpiryMs(env.JWT_ACCESS_EXPIRY);

// ─── JWT signing ──────────────────────────────────────────────────────────────

function signPlatformAccessToken(
  fastify: FastifyInstance,
  user: { id: string; email: string; role: PlatformRole },
  sessionId: string,
  mfaVerified: boolean,
) {
  return fastify.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    sid: sessionId,
    mfaVerified,
    aud: 'platform',
  });
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function setPlatformRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(PLATFORM_COOKIE_NAME, token, {
    httpOnly: true,
    secure: PLATFORM_COOKIE_SECURE,
    sameSite: 'lax',
    path: PLATFORM_COOKIE_PATH,
    ...(PLATFORM_COOKIE_DOMAIN ? { domain: PLATFORM_COOKIE_DOMAIN } : {}),
    expires: expiresAt,
  });
}

function clearPlatformRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(PLATFORM_COOKIE_NAME, {
    path: PLATFORM_COOKIE_PATH,
    ...(PLATFORM_COOKIE_DOMAIN ? { domain: PLATFORM_COOKIE_DOMAIN } : {}),
  });
}

function resolvePlatformRefreshToken(request: FastifyRequest, bodyToken?: string) {
  return bodyToken ?? request.cookies?.[PLATFORM_COOKIE_NAME] ?? null;
}

function setNoStoreHeaders(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const adminAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /admin/auth/login ───────────────────────────────────────────────
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth'],
      summary: 'Platform user login (Zikel internal staff)',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
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
        423: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = LoginBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message } });
      }

      const ua = request.headers['user-agent'];
      const result = await loginPlatformUser({
        email: parse.data.email,
        password: parse.data.password,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });

      // MFA gate: password OK but TOTP enrolled. Return short-lived challenge.
      if (result.kind === 'mfa-required') {
        setNoStoreHeaders(reply);
        return reply.send({
          success: true,
          data: {
            mfaRequired: true,
            challengeToken: result.challengeToken,
            challengeExpiresInSeconds: result.challengeExpiresInSeconds,
          },
        });
      }

      // Hard-block: platform user without TOTP enrolled. We do NOT mint a
      // session; we hand back a single-purpose enrollment token that drives
      // the FE through /admin/auth/mfa/totp/enroll/{setup,confirm}, which
      // mints the session on successful confirmation.
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          mfaEnrollmentRequired: true,
          enrollmentToken: result.enrollmentToken,
          enrollmentExpiresInSeconds: result.enrollmentExpiresInSeconds,
        },
      });
    },
  });

  // ── POST /admin/auth/logout ──────────────────────────────────────────────
  fastify.post('/logout', {
    preHandler: [fastify.authenticatePlatform],
    schema: {
      tags: ['Admin Auth'],
      summary: 'Platform user logout',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { message: { type: 'string' } } },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const platformUser = request.user as PlatformJwtPayload;
      const token = resolvePlatformRefreshToken(request);
      await logoutPlatformUser({
        platformUserId: platformUser.sub,
        sessionId: platformUser.sid ?? null,
        refreshToken: token,
      });
      clearPlatformRefreshCookie(reply);
      setNoStoreHeaders(reply);
      return reply.send({ success: true, data: { message: 'Logged out.' } });
    },
  });

  // ── POST /admin/auth/refresh ─────────────────────────────────────────────
  fastify.post('/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Admin Auth'],
      summary: 'Rotate platform refresh token',
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
      },
    },
    handler: async (request, reply) => {
      const presented = resolvePlatformRefreshToken(request);
      if (!presented) {
        throw httpError(401, 'NO_REFRESH_TOKEN', 'No refresh token provided.');
      }

      const stored = await prisma.platformRefreshToken.findUnique({
        where: { token: presented },
        include: { platformUser: true, session: true },
      });
      if (!stored || !stored.platformUser) {
        throw httpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token not recognised.');
      }
      const now = new Date();

      // ── Token-reuse detection: if the presented token has been revoked,
      // someone may have stolen it. Revoke the entire session as a tripwire.
      if (stored.revokedAt) {
        await prisma.$transaction([
          prisma.platformSession.updateMany({
            where: { id: stored.sessionId, revokedAt: null },
            data: { revokedAt: now },
          }),
          prisma.platformRefreshToken.updateMany({
            where: { sessionId: stored.sessionId, revokedAt: null },
            data: { revokedAt: now },
          }),
        ]);
        throw httpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token already used. Session revoked. Please sign in again.');
      }

      if (stored.session.revokedAt) {
        throw httpError(401, 'SESSION_REVOKED', 'Session has been revoked. Please sign in again.');
      }
      if (stored.session.absoluteExpiresAt <= now) {
        throw httpError(401, 'SESSION_ABSOLUTE_EXPIRED', 'Session expired. Please sign in again.');
      }
      if (stored.idleExpiresAt <= now) {
        throw httpError(401, 'SESSION_IDLE_EXPIRED', 'Session idle-expired. Please sign in again.');
      }
      if (!stored.platformUser.isActive) {
        throw httpError(401, 'ACCOUNT_DISABLED', 'Account is disabled.');
      }

      const newToken = generateRefreshToken();
      const sessionAbsoluteExpiresAt = stored.session.absoluteExpiresAt;
      const newIdleExpiresAt = refreshIdleExpiresAt();

      const newRecord = await prisma.platformRefreshToken.create({
        data: {
          sessionId: stored.sessionId,
          platformUserId: stored.platformUserId,
          token: newToken,
          idleExpiresAt: newIdleExpiresAt,
        },
      });
      await prisma.$transaction([
        prisma.platformRefreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: now, replacedByTokenId: newRecord.id },
        }),
        prisma.platformSession.update({
          where: { id: stored.sessionId },
          data: { lastActiveAt: now },
        }),
      ]);

      // Refresh preserves the original session's MFA-verified state — the
      // refresh token itself is bound to a session that was already MFA-validated.
      const accessToken = signPlatformAccessToken(fastify, {
        id: stored.platformUser.id,
        email: stored.platformUser.email,
        role: stored.platformUser.role,
      }, stored.sessionId, Boolean(stored.session.mfaVerifiedAt));

      setPlatformRefreshCookie(reply, newToken, sessionAbsoluteExpiresAt);
      setNoStoreHeaders(reply);

      return reply.send({
        success: true,
        data: {
          tokens: {
            accessToken,
            accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
            refreshTokenExpiresAt: sessionAbsoluteExpiresAt.toISOString(),
          },
        },
      });
    },
  });

  // ── GET /admin/auth/me ───────────────────────────────────────────────────
  fastify.get('/me', {
    preHandler: [fastify.authenticatePlatform],
    schema: {
      tags: ['Admin Auth'],
      summary: 'Get current platform user',
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
      const platformUser = request.user as PlatformJwtPayload;
      const data = await getPlatformUser(platformUser.sub);
      return reply.send({ success: true, data });
    },
  });

  // ── GET /admin/auth/sessions ─────────────────────────────────────────────
  fastify.get('/sessions', {
    preHandler: [fastify.authenticatePlatform],
    schema: {
      tags: ['Admin Auth'],
      summary: 'List active platform sessions for current user',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const platformUser = request.user as PlatformJwtPayload;
      const sessions = await listPlatformSessions(platformUser.sub);
      return reply.send({
        success: true,
        data: sessions.map((s) => ({ ...s, isCurrent: s.id === platformUser.sid })),
      });
    },
  });

  // ── DELETE /admin/auth/sessions/:id — revoke one ─────────────────────────
  fastify.delete<{ Params: { id: string } }>('/sessions/:id', {
    preHandler: [fastify.authenticatePlatform],
    schema: {
      tags: ['Admin Auth'],
      summary: 'Revoke a specific platform session',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { revoked: { type: 'integer' } } },
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const platformUser = request.user as PlatformJwtPayload;
      const result = await revokePlatformSession({
        platformUserId: platformUser.sub,
        sessionId: request.params.id,
      });
      // If revoking the current session, clear the cookie too
      if (request.params.id === platformUser.sid) {
        clearPlatformRefreshCookie(reply);
        setNoStoreHeaders(reply);
      }
      return reply.send({ success: true, data: result });
    },
  });

  // ── DELETE /admin/auth/sessions — revoke all (logout-all) ────────────────
  fastify.delete('/sessions', {
    preHandler: [fastify.authenticatePlatform],
    schema: {
      tags: ['Admin Auth'],
      summary: 'Revoke ALL platform sessions for current user (logout everywhere)',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { revoked: { type: 'integer' } } },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const platformUser = request.user as PlatformJwtPayload;
      const result = await revokeAllPlatformSessions(platformUser.sub);
      clearPlatformRefreshCookie(reply);
      setNoStoreHeaders(reply);
      return reply.send({ success: true, data: result });
    },
  });
};

export default adminAuthRoutes;
