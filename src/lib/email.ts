import type { OtpPurpose } from '@prisma/client';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// ─── Resend singleton ─────────────────────────────────────────────────────────

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

// ─── Assets ───────────────────────────────────────────────────────────────────

// Hosted public URL — Gmail blocks data: URIs so the logo is served from the app itself.
const WHITE_LOGO_URL = 'https://zikel-solutions.fly.dev/assets/white-logo.svg';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  digital_filing_cabinet: "Digital Filing Cabinet for Children's Homes",
  ai_staff_guidance: 'AI Staff Guidance & Support System',
  training_development: 'Training & Professional Development Intelligence',
  healthcare_workflow: 'Healthcare Workflow Support Software',
  general_enquiry: 'General Enquiry / Not Sure Yet',
};

function buildEmailHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">

          <!-- Header -->
          <tr>
            <td style="background-color:#02060A;padding:28px 40px">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:14px">
                    <img src="${WHITE_LOGO_URL}" alt="Zikel Solutions" height="42" style="display:block;border:0">
                  </td>
                  <td style="vertical-align:middle;border-left:1px solid rgba(255,255,255,0.2);padding-left:14px">
                    <span style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;letter-spacing:0.03em">Zikel Solutions</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Orange accent bar -->
          <tr>
            <td style="background-color:#F94D00;height:4px;font-size:0;line-height:0">&nbsp;</td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px">
              ${body}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px">
              <hr style="border:none;border-top:1px solid #eeeeee;margin:0">
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.6">
                &copy; ${new Date().getFullYear()} Zikel Solutions Ltd &middot;
                <a href="https://zikelsolutions.com" style="color:#F94D00;text-decoration:none">zikelsolutions.com</a>
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#bbbbbb;line-height:1.5">
                You received this email because you submitted a request on our website.<br>
                If this was not you, please disregard this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    logger.info({ msg: 'Email (dev — not sent via Resend)', to, subject });
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
    from: `Zikel Solutions <${fromEmail}>`,
    to,
    subject,
    html,
  });

  if (error) {
    logger.error({ msg: 'Resend delivery failed', to, error });
    throw new Error(`Email delivery failed: ${(error as { message?: string }).message ?? 'unknown error'}`);
  }
}

// ─── OTP emails ───────────────────────────────────────────────────────────────

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

  const html = buildEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;color:#02060A;font-weight:700">
      Your one-time code
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#444444;line-height:1.6">
      Use the code below to ${action}. It expires in <strong>10 minutes</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
      <tr>
        <td style="background:#f4f4f4;border:2px solid #eeeeee;border-radius:8px;padding:20px 40px;text-align:center">
          <span style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:0.3em;color:#02060A">${code}</span>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#999999;line-height:1.5">
      If you did not request this code, you can safely ignore this email.
    </p>
  `);

  if (process.env.NODE_ENV !== 'production') {
    logger.info({ msg: 'OTP email (dev — not sent via Resend)', email, subject, code });
    return;
  }

  await sendEmail(email, subject, html);
}

// ─── Book-a-Demo confirmation ─────────────────────────────────────────────────

export async function sendBookDemoConfirmationEmail(
  email: string,
  fullName: string,
  serviceOfInterest: string,
): Promise<void> {
  const serviceLabel = SERVICE_LABELS[serviceOfInterest] ?? serviceOfInterest;
  const firstName = fullName.split(' ')[0];

  const html = buildEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;color:#02060A;font-weight:700">
      Thanks for reaching out, ${firstName}!
    </h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      We've received your demo request and a member of our team will be in touch
      shortly to arrange a time that works for you.
    </p>

    <!-- Service highlight -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;border-radius:6px;overflow:hidden">
      <tr>
        <td style="background:#fef9f7;border-left:4px solid #F94D00;padding:16px 20px;border-radius:0 6px 6px 0">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Service of Interest</p>
          <p style="margin:0;font-size:15px;color:#02060A;font-weight:600">${serviceLabel}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      In the meantime, if you have any questions feel free to reply directly to this email.
    </p>
    <p style="margin:0;font-size:15px;color:#444444;line-height:1.6">
      We look forward to speaking with you.
    </p>
    <p style="margin:24px 0 0;font-size:15px;color:#02060A;font-weight:600">
      The Zikel Solutions Team
    </p>
  `);

  await sendEmail(email, 'We received your demo request — Zikel Solutions', html);
}

// ─── Contact-Us confirmation ──────────────────────────────────────────────────

export async function sendContactConfirmationEmail(
  email: string,
  fullName: string,
  serviceOfInterest: string,
): Promise<void> {
  const serviceLabel = SERVICE_LABELS[serviceOfInterest] ?? serviceOfInterest;
  const firstName = fullName.split(' ')[0];

  const html = buildEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;color:#02060A;font-weight:700">
      We've received your message, ${firstName}!
    </h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      Thank you for reaching out to Zikel Solutions. A member of our team will
      review your message and get back to you as soon as possible.
    </p>

    <!-- Service highlight -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;border-radius:6px;overflow:hidden">
      <tr>
        <td style="background:#fef9f7;border-left:4px solid #F94D00;padding:16px 20px;border-radius:0 6px 6px 0">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Area of Interest</p>
          <p style="margin:0;font-size:15px;color:#02060A;font-weight:600">${serviceLabel}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      If your query is urgent, feel free to reply directly to this email.
    </p>
    <p style="margin:0;font-size:15px;color:#02060A;font-weight:600">
      The Zikel Solutions Team
    </p>
  `);

  await sendEmail(email, "We've received your message — Zikel Solutions", html);
}

// ─── Join-Waitlist confirmation ───────────────────────────────────────────────

export async function sendWaitlistConfirmationEmail(
  email: string,
  fullName: string,
  serviceOfInterest: string,
): Promise<void> {
  const serviceLabel = SERVICE_LABELS[serviceOfInterest] ?? serviceOfInterest;
  const firstName = fullName.split(' ')[0];

  const html = buildEmailHtml(`
    <h2 style="margin:0 0 16px;font-size:22px;color:#02060A;font-weight:700">
      You're on the list, ${firstName}!
    </h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      Thank you for joining the Zikel Solutions waitlist. We're working hard to
      bring our platform to more care providers, and you'll be among the first
      to know when we're ready for you.
    </p>

    <!-- Service highlight -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;border-radius:6px;overflow:hidden">
      <tr>
        <td style="background:#fef9f7;border-left:4px solid #F94D00;padding:16px 20px;border-radius:0 6px 6px 0">
          <p style="margin:0 0 4px;font-size:11px;color:#888888;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Interested In</p>
          <p style="margin:0;font-size:15px;color:#02060A;font-weight:600">${serviceLabel}</p>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:15px;color:#444444;line-height:1.6">
      We'll reach out as soon as access becomes available. No spam — just
      the update you're waiting for.
    </p>
    <p style="margin:0;font-size:15px;color:#02060A;font-weight:600">
      The Zikel Solutions Team
    </p>
  `);

  await sendEmail(email, "You're on the Zikel Solutions waitlist", html);
}
