import type { FastifyPluginAsync } from 'fastify';
import {
  RegisterBodySchema,
  VerifyOtpBodySchema,
  ResendOtpBodySchema,
  LoginBodySchema,
  LogoutBodySchema,
  registerBodyJson,
  verifyOtpBodyJson,
  resendOtpBodyJson,
  loginBodyJson,
  logoutBodyJson,
} from './auth.schema.js';
import type { JwtPayload } from '../../types/index.js';
import * as authService from './auth.service.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /auth/register ────────────────────────────────────────────────────
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user (steps 1–3)',
      description:
        'Accepts all data collected across the 4-step signup flow (country, profile, password). ' +
        'Creates a pending user and sends a 6-digit OTP to the provided email. ' +
        'The account is activated only after OTP verification.',
      security: [],
      body: registerBodyJson,
      response: {
        201: {
          description: 'User registered — OTP sent to email.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'message'],
              properties: {
                userId: { type: 'string', description: 'Use this ID in /auth/verify-otp' },
                message: { type: 'string', example: 'OTP sent to your email address.' },
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

  // ── POST /auth/verify-otp ──────────────────────────────────────────────────
  fastify.post('/verify-otp', {
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
      const { user, refreshToken } = await authService.verifyOtp(body);
      const accessToken = fastify.jwt.sign({ sub: user.id, email: user.email, role: user.role });
      return reply.send({
        success: true,
        data: { user, tokens: { accessToken, refreshToken } },
      });
    },
  });

  // ── POST /auth/resend-otp ──────────────────────────────────────────────────
  fastify.post('/resend-otp', {
    schema: {
      tags: ['Auth'],
      summary: 'Resend OTP',
      description:
        'Issues a new OTP and invalidates the previous one. ' +
        'Enforces a cooldown period to prevent abuse. Returns remaining cooldown seconds if blocked.',
      security: [],
      body: resendOtpBodyJson,
      response: {
        200: {
          description: 'OTP resent.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string', example: 'A new OTP has been sent to your email.' },
                cooldownSeconds: {
                  type: 'integer',
                  example: 60,
                  description: 'Seconds until another resend is allowed.',
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
      const { user, refreshToken } = await authService.login(body);
      const accessToken = fastify.jwt.sign({ sub: user.id, email: user.email, role: user.role });
      return reply.send({
        success: true,
        data: { user, tokens: { accessToken, refreshToken } },
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
      await authService.logout(body.refreshToken);
      return reply.send({ success: true, data: { message: 'Logged out successfully.' } });
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
