/**
 * Owner notifications for tenant lifecycle events: suspend / reactivate.
 *
 * Best-effort: never blocks the admin route, never throws upstream. If
 * `RESEND_API_KEY` is unset (dev/local) the email body is logged so engineers
 * can see what would have shipped.
 *
 * The body is compliance-friendly: explicit reason, the platform staff member
 * who actioned it, the timestamp, and a clear contact path.
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

interface TenantLifecycleEmailArgs {
  ownerEmail: string;
  ownerName: string;
  tenantName: string;
  reason: string;
  platformUserEmail: string;
  actionedAt: Date;
}

export async function sendTenantSuspendedEmail(args: TenantLifecycleEmailArgs): Promise<void> {
  const subject = `Action required: your "${args.tenantName}" account has been suspended`;
  const text = [
    `Hi ${args.ownerName || 'there'},`,
    '',
    `Your "${args.tenantName}" account has been temporarily suspended by Zikel Solutions.`,
    `Active sessions for everyone in your organisation have been revoked, so users will be signed out.`,
    '',
    `   Reason:           ${args.reason}`,
    `   Actioned by:      ${args.platformUserEmail}`,
    `   When:             ${args.actionedAt.toUTCString()}`,
    '',
    'This action is fully audited; no data has been deleted. Once the issue is resolved we will',
    'reactivate the account and let you know.',
    '',
    'If you believe this was done in error or you need an immediate update, reply to this email or',
    'contact support@zikelsolutions.com.',
    '',
    '— Zikel Solutions',
  ].join('\n');
  await dispatch({ event: 'tenant_suspended', subject, text, args });
}

export async function sendTenantReactivatedEmail(args: TenantLifecycleEmailArgs): Promise<void> {
  const subject = `Good news: your "${args.tenantName}" account has been reactivated`;
  const text = [
    `Hi ${args.ownerName || 'there'},`,
    '',
    `Your "${args.tenantName}" account has been reactivated. You and your team can sign in again.`,
    '',
    `   Reason:           ${args.reason}`,
    `   Actioned by:      ${args.platformUserEmail}`,
    `   When:             ${args.actionedAt.toUTCString()}`,
    '',
    'No data was lost during the suspension. If you notice anything missing or unexpected, reply',
    'to this email or contact support@zikelsolutions.com.',
    '',
    '— Zikel Solutions',
  ].join('\n');
  await dispatch({ event: 'tenant_reactivated', subject, text, args });
}

async function dispatch(opts: {
  event: 'tenant_suspended' | 'tenant_reactivated';
  subject: string;
  text: string;
  args: TenantLifecycleEmailArgs;
}): Promise<void> {
  const { event, subject, text, args } = opts;
  const client = getResend();
  if (!client) {
    logger.info({
      msg: `[${event}] Owner email skipped (RESEND_API_KEY not set)`,
      to: args.ownerEmail,
      subject,
    });
    return;
  }
  if (!env.RESEND_FROM_EMAIL) {
    logger.warn({
      msg: `[${event}] RESEND_FROM_EMAIL not set — cannot send Owner notification`,
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
      msg: `[${event}] Failed to send Owner notification email`,
      to: args.ownerEmail,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
