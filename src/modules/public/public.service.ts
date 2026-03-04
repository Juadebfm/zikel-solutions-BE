import { ServiceOfInterest } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  sendBookDemoConfirmationEmail,
  sendWaitlistConfirmationEmail,
  sendContactConfirmationEmail,
} from '../../lib/email.js';
import { logger } from '../../lib/logger.js';
import type { BookDemoBody, JoinWaitlistBody, ContactUsBody } from './public.schema.js';

export async function bookDemo(body: BookDemoBody) {
  const record = await prisma.demoRequest.create({
    data: {
      fullName: body.fullName,
      email: body.email,
      organisationName: body.organisationName ?? null,
      rolePosition: body.rolePosition ?? null,
      phoneNumber: body.phoneNumber ?? null,
      serviceOfInterest: body.serviceOfInterest as ServiceOfInterest,
      numberOfStaffChildren: body.numberOfStaffChildren ?? null,
      keyChallenges: body.keyChallenges ?? null,
      message: body.message ?? null,
      source: body.source ?? null,
    },
    select: { id: true },
  });

  // Fire-and-forget — DB save already succeeded; don't fail the request if email bounces
  sendBookDemoConfirmationEmail(body.email, body.fullName, body.serviceOfInterest).catch(
    (err: unknown) => logger.error({ msg: 'Failed to send book-demo confirmation email', err }),
  );

  return {
    id: record.id,
    message: "Thanks for your interest! We'll be in touch shortly to arrange your demo.",
  };
}

export async function joinWaitlist(body: JoinWaitlistBody) {
  const record = await prisma.waitlistEntry.create({
    data: {
      fullName: body.fullName,
      email: body.email,
      organisation: body.organisation ?? null,
      serviceOfInterest: body.serviceOfInterest as ServiceOfInterest,
      source: body.source ?? null,
    },
    select: { id: true },
  });

  // Fire-and-forget — DB save already succeeded; don't fail the request if email bounces
  sendWaitlistConfirmationEmail(body.email, body.fullName, body.serviceOfInterest).catch(
    (err: unknown) => logger.error({ msg: 'Failed to send waitlist confirmation email', err }),
  );

  return {
    id: record.id,
    message: "You're on the list! We'll notify you as soon as we're ready for you.",
  };
}

export async function contactUs(body: ContactUsBody) {
  const record = await prisma.contactMessage.create({
    data: {
      fullName: body.fullName,
      email: body.email,
      phoneNumber: body.phoneNumber,
      serviceOfInterest: body.serviceOfInterest as ServiceOfInterest,
      message: body.message ?? null,
      source: body.source ?? null,
    },
    select: { id: true },
  });

  // Fire-and-forget — DB save already succeeded; don't fail the request if email bounces
  sendContactConfirmationEmail(body.email, body.fullName, body.serviceOfInterest).catch(
    (err: unknown) => logger.error({ msg: 'Failed to send contact-us confirmation email', err }),
  );

  return {
    id: record.id,
    message: "Thanks for getting in touch! We'll get back to you shortly.",
  };
}
