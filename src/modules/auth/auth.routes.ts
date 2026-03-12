import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  RegisterBodySchema,
  VerifyOtpBodySchema,
  ResendOtpBodySchema,
  LoginBodySchema,
  CheckEmailQuerySchema,
  LogoutBodySchema,
  SwitchTenantBodySchema,
  RefreshBodySchema,
  ForgotPasswordBodySchema,
  ResetPasswordBodySchema,
  registerBodyJson,
  verifyOtpBodyJson,
  resendOtpBodyJson,
  loginBodyJson,
  checkEmailQueryJson,
  logoutBodyJson,
  switchTenantBodyJson,
  refreshBodyJson,
  forgotPasswordBodyJson,
  resetPasswordBodyJson,
} from './auth.schema.js';
import type { JwtPayload } from '../../types/index.js';
import * as authService from './auth.service.js';

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

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /auth/register ────────────────────────────────────────────────────
  fastify.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user (steps 1–3)',
      description:
        'Accepts all data collected across the 4-step signup flow (country, profile, password). ' +
        'Creates a pending user and starts OTP delivery to the provided email. ' +
        'The account is activated only after OTP verification.',
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

  // ── GET /auth/check-email ─────────────────────────────────────────────────
  fastify.get('/check-email', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Check email availability',
      description: 'Returns whether an email is available before continuing signup.',
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
        404: { description: 'User not found.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const body = VerifyOtpBodySchema.parse(request.body);
      const { user, refreshToken, session } = await authService.verifyOtp(body);
      const accessToken = signAccessToken(fastify, user, session);
      return reply.send({
        success: true,
        data: { user, session, tokens: { accessToken, refreshToken } },
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
        404: { description: 'User not found.', $ref: 'ApiError#' },
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
        'Authenticates the user. On success returns an access token (15 min) and refresh token (7 days). ' +
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
      const { user, refreshToken, session } = await authService.login(body);
      const accessToken = signAccessToken(fastify, user, session);
      return reply.send({
        success: true,
        data: { user, session, tokens: { accessToken, refreshToken } },
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
        'Validates the provided refresh token. On success, atomically revokes the old token and ' +
        'issues a new access token + rotated refresh token. ' +
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
          description: 'Refresh token is invalid, expired, or already revoked.',
          $ref: 'ApiError#',
        },
        403: { description: 'Account is disabled.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const body = RefreshBodySchema.parse(request.body);
      const { user, newRefreshToken, session } = await authService.refreshAccessToken(body);
      const accessToken = signAccessToken(fastify, user, session);
      return reply.send({
        success: true,
        data: { user, session, tokens: { accessToken, refreshToken: newRefreshToken } },
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
        'Revokes the provided refresh token so it cannot be used to issue new access tokens. ' +
        'The client should also clear its local token storage.',
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
      const body = LogoutBodySchema.parse(request.body);
      const userId = (request.user as JwtPayload).sub;
      await authService.logout(body.refreshToken, userId);
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
