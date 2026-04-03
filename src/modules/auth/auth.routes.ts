import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  RegisterBodySchema,
  JoinViaInviteLinkBodySchema,
  StaffActivateBodySchema,
  VerifyOtpBodySchema,
  ResendOtpBodySchema,
  LoginBodySchema,
  CheckEmailQuerySchema,
  LogoutBodySchema,
  SwitchTenantBodySchema,
  VerifyMfaChallengeBodySchema,
  RefreshBodySchema,
  SessionExpiryQuerySchema,
  ForgotPasswordBodySchema,
  ResetPasswordBodySchema,
  registerBodyJson,
  joinViaInviteLinkBodyJson,
  staffActivateBodyJson,
  verifyOtpBodyJson,
  resendOtpBodyJson,
  loginBodyJson,
  checkEmailQueryJson,
  logoutBodyJson,
  switchTenantBodyJson,
  verifyMfaChallengeBodyJson,
  refreshBodyJson,
  sessionExpiryQueryJson,
  forgotPasswordBodyJson,
  resetPasswordBodyJson,
} from './auth.schema.js';
import type { JwtPayload } from '../../types/index.js';
import * as authService from './auth.service.js';
import { parseExpiryMs } from '../../lib/tokens.js';
import { env } from '../../config/env.js';

function signAccessToken(
  fastify: FastifyInstance,
  user: { id: string; email: string; role: JwtPayload['role'] },
  session: {
    activeTenantId: string | null;
    activeTenantRole: JwtPayload['tenantRole'];
    mfaVerified: boolean;
  },
) {
  return fastify.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: session.activeTenantId,
    tenantRole: session.activeTenantRole ?? null,
    mfaVerified: session.mfaVerified,
  });
}

const ACCESS_TOKEN_EXPIRY_MS = parseExpiryMs(env.JWT_ACCESS_EXPIRY);
const SESSION_WARNING_WINDOW_SECONDS = env.SESSION_WARNING_WINDOW_SECONDS;
const REFRESH_COOKIE_NAME = env.AUTH_REFRESH_COOKIE_NAME;
const LEGACY_REFRESH_TOKEN_IN_BODY = env.AUTH_LEGACY_REFRESH_TOKEN_IN_BODY;
const REFRESH_COOKIE_SECURE = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
const REFRESH_COOKIE_DOMAIN = env.AUTH_REFRESH_COOKIE_DOMAIN;
const REFRESH_COOKIE_PATH = env.AUTH_REFRESH_COOKIE_PATH;
const REFRESH_COOKIE_SAME_SITE = env.AUTH_REFRESH_COOKIE_SAME_SITE;

function buildTimedAuthResponse(args: {
  user: Record<string, unknown>;
  session: {
    activeTenantId: string | null;
    activeTenantRole: JwtPayload['tenantRole'];
    memberships: unknown[];
    mfaRequired: boolean;
    mfaVerified: boolean;
  };
  sessionExpiry: {
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  };
  accessToken: string;
  refreshToken?: string;
}) {
  const serverTime = new Date();
  const tokens: Record<string, string> = {
    accessToken: args.accessToken,
    accessTokenExpiresAt: new Date(serverTime.getTime() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
    refreshTokenExpiresAt: args.sessionExpiry.absoluteExpiresAt.toISOString(),
  };

  if (LEGACY_REFRESH_TOKEN_IN_BODY && args.refreshToken) {
    tokens.refreshToken = args.refreshToken;
  }

  return {
    user: args.user,
    session: {
      ...args.session,
      idleExpiresAt: args.sessionExpiry.idleExpiresAt.toISOString(),
      absoluteExpiresAt: args.sessionExpiry.absoluteExpiresAt.toISOString(),
      warningWindowSeconds: SESSION_WARNING_WINDOW_SECONDS,
    },
    tokens,
    serverTime: serverTime.toISOString(),
  };
}

function setNoStoreHeaders(reply: import('fastify').FastifyReply) {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

function setRefreshTokenCookie(
  reply: import('fastify').FastifyReply,
  refreshToken: string,
  expiresAt: Date,
) {
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: REFRESH_COOKIE_SECURE,
    sameSite: REFRESH_COOKIE_SAME_SITE,
    path: REFRESH_COOKIE_PATH,
    ...(REFRESH_COOKIE_DOMAIN ? { domain: REFRESH_COOKIE_DOMAIN } : {}),
    expires: expiresAt,
  });
}

function clearRefreshTokenCookie(reply: import('fastify').FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_PATH,
    ...(REFRESH_COOKIE_DOMAIN ? { domain: REFRESH_COOKIE_DOMAIN } : {}),
  });
}

function resolveRefreshToken(
  request: import('fastify').FastifyRequest,
  bodyRefreshToken?: string,
) {
  const cookieToken = request.cookies?.[REFRESH_COOKIE_NAME];
  return bodyRefreshToken ?? cookieToken ?? null;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /auth/register ────────────────────────────────────────────────────
  fastify.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Register a new care home organization',
      description:
        'Creates a pending user account and their care home organization in a single transaction. ' +
        'The user becomes the tenant admin. Starts OTP delivery to the provided email. ' +
        'The account is activated only after OTP verification via /auth/verify-otp.',
      security: [],
      body: registerBodyJson,
      response: {
        201: {
          description: 'User registered — includes OTP delivery status for unambiguous UI messaging.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'message', 'otpDeliveryStatus', 'resendAvailableAt'],
              properties: {
                userId: { type: 'string', description: 'Use this ID in /auth/verify-otp' },
                message: { type: 'string', example: "Account created. We're sending your OTP now." },
                otpDeliveryStatus: {
                  type: 'string',
                  enum: ['sent', 'queued', 'failed'],
                  description:
                    'Delivery state from backend perspective: provider accepted (sent), deferred (queued), or failed.',
                },
                resendAvailableAt: {
                  type: 'string',
                  format: 'date-time',
                  description: 'ISO timestamp when resend is next allowed.',
                },
              },
            },
          },
        },
        409: { description: 'Email already registered.', $ref: 'ApiError#' },


        422: { description: 'Validation error (password policy, terms, etc.).', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = RegisterBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const data = await authService.register(parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // ── GET /auth/join/:inviteCode — Validate invite link (public) ──────────────
  fastify.get('/join/:inviteCode', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Validate an invite link (public)',
      description: 'Returns the organization name and default role for a valid invite link code.',
      security: [],
      params: {
        type: 'object',
        required: ['inviteCode'],
        properties: {
          inviteCode: { type: 'string' },
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
              required: ['tenantName', 'defaultRole'],
              properties: {
                tenantName: { type: 'string' },
                tenantSlug: { type: 'string' },
                defaultRole: { type: 'string' },
              },
            },
          },
        },
        404: { $ref: 'ApiError#' },
        410: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const { inviteCode } = request.params as { inviteCode: string };
      const data = await authService.validateInviteLink(inviteCode);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /auth/join/:inviteCode ──────────────────────────────────────────────
  fastify.post('/join/:inviteCode', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Self-register via org invite link',
      description:
        'Staff registers using a shared invite link. Creates account with pending_approval membership. ' +
        'Admin must approve before the staff member can fully access the organization. ' +
        'An OTP is sent for email verification.',
      security: [],
      params: {
        type: 'object',
        required: ['inviteCode'],
        properties: {
          inviteCode: { type: 'string', description: 'The invite link code from the URL' },
        },
      },
      body: joinViaInviteLinkBodyJson,
      response: {
        201: {
          description: 'Account created with pending approval — OTP sent for email verification.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'message', 'otpDeliveryStatus', 'resendAvailableAt', 'tenantName', 'pendingApproval'],
              properties: {
                userId: { type: 'string' },
                message: { type: 'string' },
                otpDeliveryStatus: { type: 'string', enum: ['sent', 'queued', 'failed'] },
                resendAvailableAt: { type: 'string', format: 'date-time' },
                tenantName: { type: 'string' },
                pendingApproval: { type: 'boolean', enum: [true] },
              },
            },
          },
        },
        404: { description: 'Invalid invite link.', $ref: 'ApiError#' },
        409: { description: 'Email already registered.', $ref: 'ApiError#' },
        410: { description: 'Invite link expired or revoked.', $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = JoinViaInviteLinkBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const { inviteCode } = request.params as { inviteCode: string };
      const data = await authService.joinViaInviteLink(inviteCode, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // ── POST /auth/staff-activate ────────────────────────────────────────────────
  fastify.post('/staff-activate', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Activate a pre-provisioned staff account',
      description:
        'Staff enters email, 6-digit activation code (from email), and sets their password. ' +
        'On success, account is activated and tokens are issued for automatic login.',
      security: [],
      body: staffActivateBodyJson,
      response: {
        200: {
          description: 'Account activated — tokens issued.',
          $ref: 'AuthResponse#',
        },
        400: { description: 'Invalid email or activation code.', $ref: 'ApiError#' },
        409: { description: 'Account already activated.', $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = StaffActivateBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const { user, refreshToken, session, sessionExpiry } = await authService.staffActivate(parse.data);
      const accessToken = signAccessToken(fastify, user, session);
      setNoStoreHeaders(reply);
      setRefreshTokenCookie(reply, refreshToken, sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user,
          session,
          sessionExpiry,
          accessToken,
          refreshToken,
        }),
      });
    },
  });

  // ── GET /auth/check-email ─────────────────────────────────────────────────
  fastify.get('/check-email', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Check email availability',
      description:
        'Privacy-safe pre-check endpoint for signup flows. Returns a generic response to avoid account enumeration.',
      security: [],
      querystring: checkEmailQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['available'],
              properties: {
                available: { type: 'boolean' },
              },
            },
          },
        },


      },
    },
    handler: async (request, reply) => {
      const query = CheckEmailQuerySchema.parse(request.query);
      const data = await authService.checkEmailAvailability(query.email);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /auth/verify-otp ──────────────────────────────────────────────────
  fastify.post('/verify-otp', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Verify OTP and activate account',
      description:
        'Validates the 6-digit OTP. On success, activates the user account and returns tokens ' +
        'for an automatic login. On failure returns a clear error (invalid, expired, already used).',
      security: [],
      body: verifyOtpBodyJson,
      response: {
        200: {
          description: 'OTP verified — account active, tokens issued.',
          $ref: 'AuthResponse#',
        },
        400: { description: 'Invalid, expired, or already-used OTP.', $ref: 'ApiError#' },


      },
    },
    handler: async (request, reply) => {
      const body = VerifyOtpBodySchema.parse(request.body);
      const { user, refreshToken, session, sessionExpiry } = await authService.verifyOtp(body);
      const accessToken = signAccessToken(fastify, user, session);
      setNoStoreHeaders(reply);
      setRefreshTokenCookie(reply, refreshToken, sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user,
          session,
          sessionExpiry,
          accessToken,
          refreshToken,
        }),
      });
    },
  });

  // ── POST /auth/resend-otp ──────────────────────────────────────────────────
  fastify.post('/resend-otp', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Resend OTP',
      description:
        'Issues a new OTP and invalidates the previous one. ' +
        'Enforces a cooldown period to prevent abuse. Returns delivery state for unambiguous UI messaging.',
      security: [],
      body: resendOtpBodyJson,
      response: {
        200: {
          description: 'OTP regenerated — includes delivery status and next allowed resend time.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message', 'cooldownSeconds', 'otpDeliveryStatus', 'resendAvailableAt'],
              properties: {
                message: { type: 'string', example: 'A new OTP has been sent to your email.' },
                cooldownSeconds: {
                  type: 'integer',
                  example: 60,
                  description: 'Seconds until another resend is allowed.',
                },
                otpDeliveryStatus: {
                  type: 'string',
                  enum: ['sent', 'queued', 'failed'],
                  description:
                    'Delivery state from backend perspective: provider accepted (sent), deferred (queued), or failed.',
                },
                resendAvailableAt: {
                  type: 'string',
                  format: 'date-time',
                  description: 'ISO timestamp when resend is next allowed.',
                },
              },
            },
          },
        },


        429: { description: 'Cooldown in effect — too many resend requests.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const body = ResendOtpBodySchema.parse(request.body);
      const data = await authService.resendOtp(body);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      description:
        'Authenticates the user. On success returns an access token and sets a secure HttpOnly refresh-token cookie ' +
        '(12 hours absolute, 15 minutes inactivity). ' +
        'Enforces account lockout after repeated failed attempts.',
      security: [],
      body: loginBodyJson,
      response: {
        200: {
          description: 'Login successful.',
          $ref: 'AuthResponse#',
        },
        401: { description: 'Invalid credentials.', $ref: 'ApiError#' },
        403: {
          description: 'Account locked or email not verified.',
          $ref: 'ApiError#',
        },

      },
    },
    handler: async (request, reply) => {
      const body = LoginBodySchema.parse(request.body);
      const { user, refreshToken, session, sessionExpiry } = await authService.login(body);
      const accessToken = signAccessToken(fastify, user, session);
      setNoStoreHeaders(reply);
      setRefreshTokenCookie(reply, refreshToken, sessionExpiry.absoluteExpiresAt);
      return reply.send({
        success: true,
        data: buildTimedAuthResponse({
          user,
          session,
          sessionExpiry,
          accessToken,
          refreshToken,
        }),
      });
    },
  });

  // ── POST /auth/mfa/challenge ───────────────────────────────────────────────
  fastify.post('/mfa/challenge', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Request MFA code for privileged session',
      description:
        'Sends a one-time MFA code to the authenticated user when the active session is privileged.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message', 'cooldownSeconds', 'otpDeliveryStatus', 'resendAvailableAt'],
              properties: {
                message: { type: 'string' },
                cooldownSeconds: { type: 'integer' },
                otpDeliveryStatus: { type: 'string', enum: ['sent', 'queued', 'failed'] },
                resendAvailableAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        400: { $ref: 'ApiError#' },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        429: { $ref: 'ApiError#' },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const data = await authService.requestMfaChallenge(actorUserId);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /auth/mfa/verify ──────────────────────────────────────────────────
  fastify.post('/mfa/verify', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Verify MFA code for privileged session',
      description:
        'Validates the MFA one-time code and returns a new access token with `mfaVerified=true`.',
      body: verifyMfaChallengeBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['user', 'session', 'tokens'],
              properties: {
                user: { $ref: 'User#' },
                session: { $ref: 'AuthSession#' },
                tokens: {
                  type: 'object',
                  required: ['accessToken'],
                  properties: {
                    accessToken: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        400: { $ref: 'ApiError#' },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const parse = VerifyMfaChallengeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { user, session } = await authService.verifyMfaChallenge(actorUserId, parse.data);
      const accessToken = signAccessToken(fastify, user, session);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          user,
          session,
          tokens: { accessToken },
        },
      });
    },
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  fastify.post('/refresh', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Rotate refresh token and issue a new access token',
      description:
        'Validates a refresh token from secure cookie (preferred) or request body (legacy). ' +
        'On success, atomically revokes the old token and ' +
        'issues a new access token + rotated refresh token while preserving the original absolute session expiry. ' +
        'Implements single-use token rotation — a token can only be used once. ' +
        'This endpoint does NOT require an Authorization header.',
      security: [],
      body: refreshBodyJson,
      response: {
        200: {
          description: 'Tokens refreshed.',
          $ref: 'AuthResponse#',
        },
        401: {
          description:
            'Refresh token is invalid or expired, or has been replayed. ' +
            'Uses REFRESH_TOKEN_INVALID, REFRESH_TOKEN_REUSED, SESSION_IDLE_EXPIRED, SESSION_ABSOLUTE_EXPIRED.',
          $ref: 'ApiError#',
        },
        403: { description: 'Account is disabled.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const body = RefreshBodySchema.parse(request.body ?? {});
      const providedRefreshToken = resolveRefreshToken(request, body.refreshToken);

      if (!providedRefreshToken) {
        setNoStoreHeaders(reply);
        clearRefreshTokenCookie(reply);
        return reply.status(401).send({
          success: false,
          error: {
            code: 'REFRESH_TOKEN_INVALID',
            message: 'Refresh token is invalid.',
          },
        });
      }

      try {
        const { user, newRefreshToken, session, sessionExpiry } = await authService.refreshAccessToken(providedRefreshToken);
        const accessToken = signAccessToken(fastify, user, session);
        setNoStoreHeaders(reply);
        setRefreshTokenCookie(reply, newRefreshToken, sessionExpiry.absoluteExpiresAt);
        return reply.send({
          success: true,
          data: buildTimedAuthResponse({
            user,
            session,
            sessionExpiry,
            accessToken,
            refreshToken: newRefreshToken,
          }),
        });
      } catch (error) {
        const err = error as { statusCode?: number; code?: string };
        if (
          err.statusCode === 401 &&
          ['REFRESH_TOKEN_REUSED', 'SESSION_IDLE_EXPIRED', 'SESSION_ABSOLUTE_EXPIRED'].includes(
            err.code ?? '',
          )
        ) {
          setNoStoreHeaders(reply);
          clearRefreshTokenCookie(reply);
        }
        throw error;
      }
    },
  });

  // ── GET /auth/session-expiry ───────────────────────────────────────────────
  fastify.get('/session-expiry', {
    schema: {
      tags: ['Auth'],
      summary: 'Resolve current session expiry timestamps',
      description:
        'Returns authoritative server time and session expiry metadata for countdown UX. ' +
        'Optionally accepts a refresh token in query to resolve a specific browser session.',
      querystring: sessionExpiryQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['serverTime', 'session', 'tokens'],
              properties: {
                serverTime: { type: 'string', format: 'date-time' },
                session: { $ref: 'AuthSessionExpiry#' },
                tokens: {
                  type: 'object',
                  required: ['refreshTokenExpiresAt'],
                  properties: {
                    refreshTokenExpiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        401: {
          description:
            'Session expired, refresh token invalid, or refresh token replayed. ' +
            'Uses SESSION_IDLE_EXPIRED, SESSION_ABSOLUTE_EXPIRED, REFRESH_TOKEN_INVALID, REFRESH_TOKEN_REUSED.',
          $ref: 'ApiError#',
        },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const query = SessionExpiryQuerySchema.parse(request.query);
      const data = await authService.getSessionExpiry(actorUserId, query.refreshToken);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          ...data,
          session: {
            ...data.session,
            idleExpiresAt: data.session.idleExpiresAt.toISOString(),
            absoluteExpiresAt: data.session.absoluteExpiresAt.toISOString(),
            warningWindowSeconds: SESSION_WARNING_WINDOW_SECONDS,
          },
          tokens: {
            refreshTokenExpiresAt: data.tokens.refreshTokenExpiresAt.toISOString(),
          },
        },
      });
    },
  });

  // ── POST /auth/switch-tenant ───────────────────────────────────────────────
  fastify.post('/switch-tenant', {
    schema: {
      tags: ['Auth'],
      summary: 'Switch active tenant context',
      description:
        'Sets the active tenant for the authenticated user when they have an active membership. ' +
        'Returns a new access token containing tenant claims.',
      body: switchTenantBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['user', 'session', 'tokens'],
              properties: {
                user: { $ref: 'User#' },
                session: { $ref: 'AuthSession#' },
                tokens: {
                  type: 'object',
                  required: ['accessToken'],
                  properties: {
                    accessToken: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        401: { description: 'Missing or invalid access token.', $ref: 'ApiError#' },
        403: { description: 'No active membership in requested tenant.', $ref: 'ApiError#' },
        404: { description: 'User not found.', $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const body = SwitchTenantBodySchema.parse(request.body);
      const actorUserId = (request.user as JwtPayload).sub;
      const { user, session } = await authService.switchTenant(actorUserId, body.tenantId);
      const accessToken = signAccessToken(fastify, user, session);
      setNoStoreHeaders(reply);
      return reply.send({
        success: true,
        data: {
          user,
          session,
          tokens: { accessToken },
        },
      });
    },
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  fastify.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout and revoke refresh token',
      description:
        'Revokes the active refresh token (from secure cookie or request body) so it cannot be used to issue new access tokens. ' +
        'Also clears the refresh-token cookie.',
      body: logoutBodyJson,
      response: {
        200: {
          description: 'Logged out successfully.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: { message: { type: 'string', example: 'Logged out successfully.' } },
            },
          },
        },
        401: { description: 'Missing or invalid access token.', $ref: 'ApiError#' },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const body = LogoutBodySchema.parse(request.body ?? {});
      const userId = (request.user as JwtPayload).sub;
      const refreshToken = resolveRefreshToken(request, body.refreshToken);
      if (refreshToken) {
        await authService.logout(refreshToken, userId);
      }
      setNoStoreHeaders(reply);
      clearRefreshTokenCookie(reply);
      return reply.send({ success: true, data: { message: 'Logged out successfully.' } });
    },
  });

  // ── POST /auth/forgot-password ─────────────────────────────────────────────
  fastify.post('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Request a password reset OTP',
      description:
        'Sends a 6-digit password-reset OTP to the given email address. ' +
        'Always returns the same response regardless of whether the email is registered, ' +
        'to prevent user enumeration.',
      security: [],
      body: forgotPasswordBodyJson,
      response: {
        200: {
          description: 'OTP dispatched (or silently skipped if email is unregistered).',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string', example: 'If that email is registered, an OTP has been sent.' },
              },
            },
          },
        },


        429: { description: 'Too many requests.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const body = ForgotPasswordBodySchema.parse(request.body);
      const data = await authService.forgotPassword(body);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /auth/reset-password ───────────────────────────────────────────────
  fastify.post('/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Reset password using OTP',
      description:
        'Verifies the 6-digit password-reset OTP issued by /forgot-password for the submitted email. ' +
        'On success, updates the password and revokes all active refresh tokens, ' +
        'forcing re-authentication on all devices.',
      security: [],
      body: resetPasswordBodyJson,
      response: {
        200: {
          description: 'Password reset successfully.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string', example: 'Password reset successfully. Please log in with your new password.' },
              },
            },
          },
        },
        400: { description: 'Invalid, expired, or already-used OTP.', $ref: 'ApiError#' },


        422: { description: 'Validation error (password policy, passwords do not match).', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ResetPasswordBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const data = await authService.resetPassword(parse.data);
      return reply.send({ success: true, data });
    },
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────
  fastify.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current authenticated user',
      description: 'Returns the profile of the currently authenticated user from the JWT payload.',
      response: {
        200: {
          description: 'Current user profile.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'User#' },
          },
        },
        401: { description: 'Missing or expired access token.', $ref: 'ApiError#' },
      },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const user = await authService.getMe((request.user as JwtPayload).sub);
      return reply.send({ success: true, data: user });
    },
  });
};

export default authRoutes;
