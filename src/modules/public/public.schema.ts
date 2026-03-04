import { z } from 'zod';

// ─── Shared ───────────────────────────────────────────────────────────────────

export const SERVICE_OPTIONS = [
  'digital_filing_cabinet',
  'ai_staff_guidance',
  'training_development',
  'healthcare_workflow',
  'general_enquiry',
] as const;

// ─── Book-a-Demo ──────────────────────────────────────────────────────────────

export const BookDemoBodySchema = z.object({
  fullName: z.string().min(1).max(150),
  email: z.email(),
  organisationName: z.string().max(150).optional(),
  rolePosition: z.string().max(150).optional(),
  phoneNumber: z.string().min(7).max(30).optional(),
  serviceOfInterest: z.enum(SERVICE_OPTIONS),
  numberOfStaffChildren: z.string().max(50).optional(),
  keyChallenges: z.string().max(2000).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(100).optional(),
});

export type BookDemoBody = z.infer<typeof BookDemoBodySchema>;

export const bookDemoBodyJson = {
  type: 'object',
  required: ['fullName', 'email', 'serviceOfInterest'],
  additionalProperties: false,
  properties: {
    fullName: { type: 'string', minLength: 1, maxLength: 150 },
    email: { type: 'string', format: 'email' },
    organisationName: { type: 'string', maxLength: 150 },
    rolePosition: { type: 'string', maxLength: 150 },
    phoneNumber: { type: 'string', minLength: 7, maxLength: 30 },
    serviceOfInterest: { type: 'string', enum: SERVICE_OPTIONS },
    numberOfStaffChildren: { type: 'string', maxLength: 50 },
    keyChallenges: { type: 'string', maxLength: 2000 },
    message: { type: 'string', maxLength: 2000 },
    source: { type: 'string', maxLength: 100 },
  },
} as const;

// ─── Join Waitlist ────────────────────────────────────────────────────────────

export const JoinWaitlistBodySchema = z.object({
  fullName: z.string().min(1).max(150),
  email: z.email(),
  organisation: z.string().max(150).optional(),
  serviceOfInterest: z.enum(SERVICE_OPTIONS),
  source: z.string().max(100).optional(),
});

export type JoinWaitlistBody = z.infer<typeof JoinWaitlistBodySchema>;

export const joinWaitlistBodyJson = {
  type: 'object',
  required: ['fullName', 'email', 'serviceOfInterest'],
  additionalProperties: false,
  properties: {
    fullName: { type: 'string', minLength: 1, maxLength: 150 },
    email: { type: 'string', format: 'email' },
    organisation: { type: 'string', maxLength: 150 },
    serviceOfInterest: { type: 'string', enum: SERVICE_OPTIONS },
    source: { type: 'string', maxLength: 100 },
  },
} as const;
