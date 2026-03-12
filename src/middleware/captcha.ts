import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { verifyCaptcha } from '../lib/captcha.js';

function extractHeaderValue(request: FastifyRequest, headerName: string) {
  const value = request.headers[headerName];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function extractCaptchaToken(request: FastifyRequest): string | null {
  const headerToken = extractHeaderValue(request, 'x-captcha-token');
  if (headerToken && typeof headerToken === 'string') {
    return headerToken;
  }

  const body = request.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).captchaToken;
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }

  const query = request.query;
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    const value = (query as Record<string, unknown>).captchaToken;
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }

  return null;
}

export function requireCaptcha(action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.CAPTCHA_ENABLED) {
      return;
    }

    const token = extractCaptchaToken(request);
    if (!token) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'CAPTCHA_REQUIRED',
          message: 'Captcha verification is required for this endpoint.',
        },
      });
    }

    const verification = await verifyCaptcha({
      token,
      action,
      remoteIp: request.ip ?? null,
    });

    if (!verification.ok && verification.reason === 'misconfigured') {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'CAPTCHA_NOT_CONFIGURED',
          message: 'Captcha verification is not configured.',
        },
      });
    }

    if (!verification.ok) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'CAPTCHA_INVALID',
          message: 'Captcha verification failed.',
        },
      });
    }
  };
}
