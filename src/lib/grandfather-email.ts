/**
 * Phase 7.9 — Owner email when their tenant is grandfathered onto a 30-day
 * complimentary trial during the Phase 7 billing rollout.
 *
 * Best-effort: never blocks the migration script, never throws upstream. If
 * `RESEND_API_KEY` is unset (dev/local) the email body is logged so engineers
 * can see what would have shipped. Same pattern as `tenant-lifecycle-email.ts`
 * and `impersonation-email.ts`.
 *
 * Subject + body copy mirrors the suggested copy in payment.md's "Email copy"
 * section. Julius approved that copy; if you change anything substantive,
 * update payment.md too.
 */

import { Resend } from 'resend';
import { logger } from './logger.js';
import { env } from '../config/env.js';

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export interface GrandfatheredTrialEmailArgs {
  ownerEmail: string;
  ownerName: string;
  tenantName: string;
  trialEndsAt: Date;
}

export async function sendGrandfatheredTrialEmail(
  args: GrandfatheredTrialEmailArgs,
): Promise<void> {
  const subject = `A small change to your Zikel account — 30-day complimentary trial`;
  const text = [
    `Hi ${args.ownerName || 'there'},`,
    '',
    `We're rolling out subscriptions on the Zikel platform. As an existing customer, your "${args.tenantName}" account has been put on a complimentary 30-day trial — you keep full access through ${args.trialEndsAt.toUTCString()}, no payment method required.`,
    '',
    `When the trial ends, you'll be asked to choose between £30/month or £300/year (2 months free). Both include 1,000 AI assistant calls per month and all current features.`,
    '',
    `No action needed today. We'll remind you 7 days, 1 day, and on the day your trial ends. You can subscribe early at any time from Settings → Billing.`,
    '',
    `Reply to this email with any questions.`,
    '',
    `— The Zikel team`,
  ].join('\n');

  const client = getResend();
  if (!client) {
    logger.info({
      msg: '[grandfather] Owner email skipped (RESEND_API_KEY not set)',
      to: args.ownerEmail,
      subject,
    });
    return;
  }
  if (!env.RESEND_FROM_EMAIL) {
    logger.warn({
      msg: '[grandfather] RESEND_FROM_EMAIL not set — cannot send Owner email',
      to: args.ownerEmail,
    });
    return;
  }
  try {
    await client.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: args.ownerEmail,
      subject,
      text,
    });
  } catch (err) {
    logger.warn({
      msg: '[grandfather] Failed to send Owner email',
      to: args.ownerEmail,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
