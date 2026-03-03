import type { OtpPurpose } from '@prisma/client';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// Lazy singleton — only constructed once and only when a real send is attempted.
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    if (!env.RESEND_API_KEY) {
      throw new Error(
        'RESEND_API_KEY is not set. Add it to your environment or fly secrets before deploying.',
      );
    }
    _resend = new Resend(env.RESEND_API_KEY);
  }
  return _resend;
}

/**
 * Sends a one-time password email to the given address.
 *
 * In development/staging the OTP is logged to the console so you can test
 * without a real mail provider.  In production, Resend is used.
 */
export async function sendOtpEmail(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<void> {
  const subject =
    purpose === 'email_verification'
      ? 'Your Zikel Solutions verification code'
      : 'Your Zikel Solutions password reset code';

  const action =
    purpose === 'email_verification'
      ? 'verify your email address'
      : 'reset your password';

  const html = `
    <p>Use the code below to ${action}. It expires in <strong>10 minutes</strong>.</p>
    <h2 style="letter-spacing:0.2em;font-family:monospace">${code}</h2>
    <p style="color:#888;font-size:12px">If you did not request this, you can safely ignore this email.</p>
  `.trim();

  if (process.env.NODE_ENV !== 'production') {
    logger.info({ msg: 'OTP email (dev — not sent via Resend)', email, subject, code });
    return;
  }

  const fromEmail = env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error(
      'RESEND_FROM_EMAIL is not set. Add it to your environment or fly secrets before deploying.',
    );
  }

  const resend = getResend();
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject,
    html,
  });

  if (error) {
    logger.error({ msg: 'Resend delivery failed', email, error });
    throw new Error(`Email delivery failed: ${(error as { message?: string }).message ?? 'unknown error'}`);
  }
}
