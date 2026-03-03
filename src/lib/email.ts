import type { OtpPurpose } from '@prisma/client';
import { logger } from './logger.js';

/**
 * Sends a one-time password email to the given address.
 *
 * In development the OTP is logged to the console so you can test without a
 * real mail provider.  In production this throws a clear error until an
 * email provider (Resend, SendGrid, SMTP, etc.) is wired up.
 */
export async function sendOtpEmail(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<void> {
  const subject =
    purpose === 'email_verification' ? 'Verify your email address' : 'Reset your password';

  if (process.env.NODE_ENV !== 'production') {
    logger.info({ msg: 'OTP email (dev — not sent)', email, subject, code });
    return;
  }

  // TODO: plug in Resend / SendGrid / SMTP here before going to production.
  throw new Error(
    'Email sending is not configured. Set up a mail provider in src/lib/email.ts before deploying to production.',
  );
}
