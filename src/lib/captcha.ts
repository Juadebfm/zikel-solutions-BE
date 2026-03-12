import { env } from '../config/env.js';
import { logger } from './logger.js';

type VerifyCaptchaInput = {
  token: string;
  action?: string;
  remoteIp?: string | null;
};

type CaptchaProviderResponse = {
  success?: boolean;
  action?: string;
  score?: number;
};

export type CaptchaVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'misconfigured' | 'provider_error' };

export async function verifyCaptcha(input: VerifyCaptchaInput): Promise<CaptchaVerificationResult> {
  if (!env.CAPTCHA_ENABLED) {
    return { ok: true };
  }
  if (!env.CAPTCHA_SECRET_KEY) {
    return { ok: false, reason: 'misconfigured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.CAPTCHA_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({
      secret: env.CAPTCHA_SECRET_KEY,
      response: input.token,
    });
    if (input.remoteIp) {
      body.append('remoteip', input.remoteIp);
    }

    const response = await fetch(env.CAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn({
        msg: 'Captcha provider request failed.',
        statusCode: response.status,
      });
      return { ok: false, reason: 'provider_error' };
    }

    const payload = (await response.json()) as CaptchaProviderResponse;
    if (payload.success !== true) {
      return { ok: false, reason: 'invalid' };
    }

    if (input.action && typeof payload.action === 'string' && payload.action !== input.action) {
      return { ok: false, reason: 'invalid' };
    }

    if (typeof payload.score === 'number' && payload.score < env.CAPTCHA_MIN_SCORE) {
      return { ok: false, reason: 'invalid' };
    }

    return { ok: true };
  } catch (error) {
    logger.warn({
      msg: 'Captcha verification threw an error.',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { ok: false, reason: 'provider_error' };
  } finally {
    clearTimeout(timeout);
  }
}
