/**
 * Sends a "Zikel support is accessing your account" email to the tenant Owner
 * when an impersonation grant is issued. Best-effort: never blocks the route,
 * and fails silently except for a warning log.
 *
 * The body follows compliance-friendly defaults — explicit ticket reference,
 * an expiry timestamp, and an instruction for the Owner to contact security
 * if the access wasn't expected.
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

export async function sendImpersonationStartedEmail(args: {
  ownerEmail: string;
  ownerName: string;
  tenantName: string;
  ticketReference: string;
  expiresAt: Date;
  platformUserEmail: string;
}): Promise<void> {
  const subject = `Zikel support accessed your account on behalf of ticket ${args.ticketReference}`;
  const text = [
    `Hi ${args.ownerName || 'there'},`,
    '',
    `A member of Zikel's support team accessed your "${args.tenantName}" account.`,
    '',
    `   Support engineer: ${args.platformUserEmail}`,
    `   Ticket reference: ${args.ticketReference}`,
    `   Access expires:   ${args.expiresAt.toUTCString()}`,
    '',
    'Every action they perform is logged with their identity and the ticket above.',
    '',
    "If you weren't expecting this, reply to this email immediately or contact security@zikelsolutions.com.",
    '',
    '— Zikel Solutions',
  ].join('\n');

  const client = getResend();
  if (!client) {
    // Dev / unconfigured environments — log so engineers can see the message body.
    logger.info({
      msg: '[impersonation] Owner email skipped (RESEND_API_KEY not set)',
      to: args.ownerEmail,
      subject,
    });
    return;
  }

  if (!env.RESEND_FROM_EMAIL) {
    logger.warn({
      msg: '[impersonation] RESEND_FROM_EMAIL not set — cannot send Owner notification',
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
      msg: '[impersonation] Failed to send Owner notification email',
      to: args.ownerEmail,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
