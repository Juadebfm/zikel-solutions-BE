import type { FastifyPluginAsync } from 'fastify';
import {
  RegisterBodySchema,
  VerifyOtpBodySchema,
  ResendOtpBodySchema,
  LoginBodySchema,
  CheckEmailQuerySchema,
  CheckOrgSlugQuerySchema,
  LogoutBodySchema,
  SwitchTenantBodySchema,
  RefreshBodySchema,
  SessionExpiryQuerySchema,
  ForgotPasswordBodySchema,
  ResetPasswordBodySchema,
  registerBodyJson,
  verifyOtpBodyJson,
  resendOtpBodyJson,
  loginBodyJson,
  checkEmailQueryJson,
  checkOrgSlugQueryJson,
  logoutBodyJson,
  switchTenantBodyJson,
  refreshBodyJson,
  sessionExpiryQueryJson,
  forgotPasswordBodyJson,
  resetPasswordBodyJson,
} from './auth.schema.js';
import type { JwtPayload } from '../../types/index.js';
import * as authService from './auth.service.js';
import { sendValidationError } from '../../lib/errors.js';
// All session-cookie + access-token + timed-auth-response logic lives in
// auth.helpers.ts. Keeping this file as a pure route definition avoids the
// drift that previously caused the __Host- dev-cookie bug (PR #6).
import {
  buildTimedAuthResponse,
  clearTenantRefreshCookie,
  resolveTenantRefreshToken,
  SESSION_WARNING_WINDOW_SECONDS,
  setNoStoreHeaders,
  setTenantRefreshCookie,
  signTenantAccessToken,
} from './auth.helpers.js';

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
        return sendValidationError(reply, parse.error);
      }
      const data = await authService.register(parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // Phase 5: legacy /auth/join/:inviteCode and /auth/staff-activate routes
  // removed. Staff onboarding is handled by the unified Invitation flow:
  //   - admin: POST /api/v1/invitations
  //   - recipient: POST /api/v1/auth/invitations/:token/accept

  // ── GET /auth/check-email ─────────────────────────────────────────────────
  // Real availability check for the signup step-2 onBlur signal. Response time
  // is normalised in the service so timing cannot leak hit vs miss.
  fastify.get('/check-email', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },

    schema: {
      tags: ['Auth'],
      summary: 'Check email availability',
      description:
        'Returns whether the email is available for registration. Response time is padded to a fixed minimum to deny timing-based enumeration.',
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

  // ── GET /auth/check-org-slug ──────────────────────────────────────────────
  // Step-2 onBlur signal for the organisation name. Backend normalises the raw
  // input via slugify so the FE doesn't have to mirror the normalisation rules.
  fastify.get('/check-org-slug', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Check organisation slug availability',
      description:
        'Normalises the raw input via slugify, then returns whether the slug is available. Response time is padded to deny timing-based enumeration.',
      security: [],
      querystring: checkOrgSlugQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['available', 'slug'],
              properties: {
                available: { type: 'boolean' },
                slug: {
                  type: 'string',
                  description: 'Normalised slug used for the lookup (empty if input could not be slugified).',
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const query = CheckOrgSlugQuerySchema.parse(request.query);
      const data = await authService.checkOrgSlugAvailability(query.slug);
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
      const { user, refreshToken, session, sessionId, sessionExpiry } = await authService.verifyOtp(body);
      const accessToken = signTenantAccessToken(fastify, user, session, sessionId);
      setNoStoreHeaders(reply);
      setTenantRefreshCookie(reply, refreshToken, sessionExpiry.absoluteExpiresAt);
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
          description:
            'Login successful — body is either an `AuthResponse` (kind: completed) or ' +
            '`{ success, data: { mfaRequired, challengeToken, challengeExpiresInSeconds } }` (kind: mfa-required). ' +
            'The handler discriminates which to return based on whether TOTP is enrolled. ' +
            'Schema deliberately permissive: fast-json-stringify cannot reliably serialize a ' +
            'discriminated union via `oneOf` when the shapes share `success`/`data` keys.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
          additionalProperties: true,
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
      const result = await authService.login(body);

      // MFA gate: password OK, but the user has TOTP enabled. Issue a short-
      // lived challenge token instead of a session. Client posts the 6-digit
      // code (or a backup code) to /auth/mfa/totp/verify or .../backup/verify.
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

      // Hard-block: privileged user (Owner) without TOTP enrolled. We do not
      // mint a session — instead we hand back an enrollment token that drives
      // the FE through the same single-flow setup that mints a session on
      // successful confirmation at /auth/mfa/totp/enroll/confirm.
      if (result.kind === 'mfa-enrollment-required') {
        setNoStoreHeaders(reply);
        return reply.send({
          success: true,
          data: {
            mfaEnrollmentRequired: true,
            enrollmentToken: result.enrollmentToken,
            enrollmentExpiresInSeconds: result.enrollmentExpiresInSeconds,
          },
        });
      }

      const { user, refreshToken, session, sessionId, sessionExpiry } = result;
      const accessToken = signTenantAccessToken(fastify, user, session, sessionId);
      setNoStoreHeaders(reply);
      setTenantRefreshCookie(reply, refreshToken, sessionExpiry.absoluteExpiresAt);
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
      const providedRefreshToken = resolveTenantRefreshToken(request, body.refreshToken);

      if (!providedRefreshToken) {
        setNoStoreHeaders(reply);
        clearTenantRefreshCookie(reply);
        return reply.status(401).send({
          success: false,
          error: {
            code: 'REFRESH_TOKEN_INVALID',
            message: 'Refresh token is invalid.',
          },
        });
      }

      try {
        const { user, newRefreshToken, session, sessionId, sessionExpiry } = await authService.refreshAccessToken(providedRefreshToken);
        const accessToken = signTenantAccessToken(fastify, user, session, sessionId);
        setNoStoreHeaders(reply);
        setTenantRefreshCookie(reply, newRefreshToken, sessionExpiry.absoluteExpiresAt);
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
          clearTenantRefreshCookie(reply);
        }
        throw error;
      }
    },
  });

  // ── GET /auth/session/peek ────────────────────────────────────────────────
  // Cookie-only validity probe for SSR middleware. Reads the refresh-token
  // cookie directly, validates without rotating, and returns 200 + expiry
  // timestamps or 401. Idempotent — `lastActiveAt` is NOT updated so frequent
  // calls don't keep idle sessions alive.
  fastify.get('/session/peek', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Probe refresh-token validity without rotating',
      description:
        'Soft validity check for SSR middleware. Reads the refresh-token cookie, validates the row + session, and returns expiry timestamps. Does NOT rotate the token or update lastActiveAt.',
      security: [],
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['valid', 'serverTime'],
              properties: {
                valid: { type: 'boolean', enum: [true] },
                serverTime: { type: 'string', format: 'date-time' },
                session: {
                  type: 'object',
                  required: ['idleExpiresAt', 'absoluteExpiresAt'],
                  properties: {
                    idleExpiresAt: { type: 'string', format: 'date-time' },
                    absoluteExpiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'No cookie present, or refresh token invalid / expired / revoked.',
          $ref: 'ApiError#',
        },
      },
    },
    handler: async (request, reply) => {
      const refreshToken = resolveTenantRefreshToken(request);
      if (!refreshToken) {
        setNoStoreHeaders(reply);
        return reply.status(401).send({
          success: false,
          error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid.' },
        });
      }
      const result = await authService.peekSessionFromRefreshToken(refreshToken);
      setNoStoreHeaders(reply);
      if (!result.valid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid.' },
        });
      }
      return reply.send({
        success: true,
        data: {
          valid: true,
          serverTime: new Date().toISOString(),
          session: {
            idleExpiresAt: result.session.idleExpiresAt.toISOString(),
            absoluteExpiresAt: result.session.absoluteExpiresAt.toISOString(),
          },
        },
      });
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
      const accessToken = signTenantAccessToken(fastify, user, session, (request.user as JwtPayload).sid ?? null);
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
      const jwt = request.user as JwtPayload;
      const refreshToken = resolveTenantRefreshToken(request, body.refreshToken);
      await authService.logout({
        actorUserId: jwt.sub,
        sessionId: jwt.sid ?? null,
        refreshToken: refreshToken ?? null,
      });
      setNoStoreHeaders(reply);
      clearTenantRefreshCookie(reply);
      return reply.send({ success: true, data: { message: 'Logged out successfully.' } });
    },
  });

  // ── GET /auth/sessions ───────────────────────────────────────────────────
  fastify.get('/sessions', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'List active sessions for current user',
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
      const jwt = request.user as JwtPayload;
      const sessions = await authService.listTenantSessions(jwt.sub);
      return reply.send({
        success: true,
        data: sessions.map((s) => ({ ...s, isCurrent: s.id === jwt.sid })),
      });
    },
  });

  // ── DELETE /auth/sessions/:id — revoke one ───────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/sessions/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Revoke a specific session',
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
      const jwt = request.user as JwtPayload;
      const result = await authService.revokeTenantSession({
        userId: jwt.sub,
        sessionId: request.params.id,
      });
      if (request.params.id === jwt.sid) {
        clearTenantRefreshCookie(reply);
        setNoStoreHeaders(reply);
      }
      return reply.send({ success: true, data: result });
    },
  });

  // ── DELETE /auth/sessions — revoke all (logout-all) ──────────────────────
  fastify.delete('/sessions', {
    preHandler: [fastify.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Revoke ALL sessions for current user (logout everywhere)',
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
      const jwt = request.user as JwtPayload;
      const result = await authService.revokeAllTenantSessions(jwt.sub);
      clearTenantRefreshCookie(reply);
      setNoStoreHeaders(reply);
      return reply.send({ success: true, data: result });
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
        return sendValidationError(reply, parse.error);
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
