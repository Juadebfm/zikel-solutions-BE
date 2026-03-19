/**
 * Auth module — Zod validation schemas + JSON Schema constants.
 *
 * Zod schemas: used in service layer for type-safe parsing.
 * JSON Schema objects: used in route `schema` option for AJV validation + OpenAPI docs.
 */
import { z } from 'zod';

// ─── Password policy ──────────────────────────────────────────────────────────

export const passwordSchema = z
  .string()
  .min(12, 'Minimum 12 characters')
  .max(128, 'Maximum 128 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a special character')
  .regex(/^\S+$/, 'Must not contain spaces');

// ─── Zod schemas (service layer) ──────────────────────────────────────────────

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RegisterBodySchema = z
  .object({
    country: z.enum(['UK', 'Nigeria']),
    firstName: z.string().min(1).max(100),
    middleName: z.string().max(100).optional(),
    lastName: z.string().min(1).max(100),
    gender: z.enum(['male', 'female', 'other']).optional(),
    email: z.email(),
    phoneNumber: z.string().min(7).max(20).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms and conditions.' }),
    organizationName: z.string().min(2).max(120),
    organizationSlug: z.string().min(2).max(120).regex(slugRegex).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const VerifyOtpEmailBodySchema = z.object({
  email: z.email(),
  code: z.string().length(6, 'OTP must be exactly 6 digits'),
});

const VerifyOtpLegacyBodySchema = z.object({
  userId: z.string().min(1),
  code: z.string().length(6, 'OTP must be exactly 6 digits'),
  // Restricted to email_verification only — password_reset OTPs are consumed by /reset-password
  purpose: z.literal('email_verification').optional(),
});

export const VerifyOtpBodySchema = z
  .union([VerifyOtpEmailBodySchema, VerifyOtpLegacyBodySchema]);

export const ForgotPasswordBodySchema = z.object({
  email: z.email(),
});

export const ResetPasswordBodySchema = z
  .object({
    email: z.email(),
    code: z.string().length(6, 'OTP must be exactly 6 digits'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

const ResendOtpEmailBodySchema = z.object({
  email: z.email(),
  purpose: z.literal('email_verification').optional(),
});

const ResendOtpLegacyBodySchema = z.object({
  userId: z.string().min(1),
  purpose: z.enum(['email_verification', 'password_reset']),
});

export const ResendOtpBodySchema = z
  .union([ResendOtpEmailBodySchema, ResendOtpLegacyBodySchema]);

export const JoinViaInviteLinkBodySchema = z
  .object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.email(),
    phoneNumber: z.string().min(7).max(20).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms and conditions.' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const joinViaInviteLinkBodyJson = {
  type: 'object',
  required: ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'acceptTerms'],
  additionalProperties: false,
  properties: {
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    phoneNumber: { type: 'string', minLength: 7, maxLength: 20 },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 128,
      description: 'Min 12 chars, must include uppercase, lowercase, number, special character, and no spaces.',
    },
    confirmPassword: { type: 'string', minLength: 12, maxLength: 128 },
    acceptTerms: { type: 'boolean', enum: [true], description: 'Must be true to register.' },
  },
} as const;

export const StaffActivateBodySchema = z
  .object({
    email: z.email(),
    code: z.string().length(6, 'Activation code must be exactly 6 digits'),
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms and conditions.' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const staffActivateBodyJson = {
  type: 'object',
  required: ['email', 'code', 'password', 'confirmPassword', 'acceptTerms'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit activation code from email' },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 128,
      description: 'Min 12 chars, must include uppercase, lowercase, number, special character, and no spaces.',
    },
    confirmPassword: { type: 'string', minLength: 12, maxLength: 128 },
    acceptTerms: { type: 'boolean', enum: [true], description: 'Must be true to activate.' },
  },
} as const;

export const LoginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const CheckEmailQuerySchema = z.object({
  email: z.email(),
});

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const SwitchTenantBodySchema = z.object({
  tenantId: z.string().min(1),
});

export const VerifyMfaChallengeBodySchema = z.object({
  code: z.string().length(6, 'OTP must be exactly 6 digits'),
});

// ─── JSON Schemas (route validation + OpenAPI) ────────────────────────────────

export const registerBodyJson = {
  type: 'object',
  required: ['country', 'firstName', 'lastName', 'email', 'password', 'confirmPassword', 'acceptTerms', 'organizationName'],
  additionalProperties: false,
  properties: {
    country: { type: 'string', enum: ['UK', 'Nigeria'], description: 'Country of residence' },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    middleName: { type: 'string', maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    gender: { type: 'string', enum: ['male', 'female', 'other'] },
    email: { type: 'string', format: 'email' },
    phoneNumber: { type: 'string', minLength: 7, maxLength: 20 },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 128,
      description: 'Min 12 chars, must include uppercase, lowercase, number, special character, and no spaces.',
    },
    confirmPassword: { type: 'string', minLength: 12, maxLength: 128 },
    acceptTerms: { type: 'boolean', enum: [true], description: 'Must be true to register.' },
    organizationName: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
      description: 'Name of the care home / organization.',
    },
    organizationSlug: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      description: 'URL-friendly slug. Auto-generated from organizationName if omitted.',
    },
  },
} as const;

export const verifyOtpBodyJson = {
  anyOf: [
    {
      type: 'object',
      required: ['email', 'code'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP sent to email' },
      },
    },
    {
      type: 'object',
      required: ['userId', 'code'],
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP sent to email' },
        purpose: { type: 'string', enum: ['email_verification'] },
      },
    },
  ],
} as const;

export const forgotPasswordBodyJson = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
  },
} as const;

export const resetPasswordBodyJson = {
  type: 'object',
  required: ['email', 'code', 'newPassword', 'confirmPassword'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP from forgot-password email' },
    newPassword: {
      type: 'string',
      minLength: 12,
      maxLength: 128,
      description: 'Min 12 chars, must include uppercase, lowercase, number, special character, and no spaces.',
    },
    confirmPassword: { type: 'string', minLength: 12, maxLength: 128 },
  },
} as const;

export const resendOtpBodyJson = {
  anyOf: [
    {
      type: 'object',
      required: ['email'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        purpose: { type: 'string', enum: ['email_verification'] },
      },
    },
    {
      type: 'object',
      required: ['userId', 'purpose'],
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        purpose: { type: 'string', enum: ['email_verification', 'password_reset'] },
      },
    },
  ],
} as const;

export const loginBodyJson = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
} as const;

export const checkEmailQueryJson = {
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
  },
} as const;

export const logoutBodyJson = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string' },
  },
} as const;

export const switchTenantBodyJson = {
  type: 'object',
  required: ['tenantId'],
  additionalProperties: false,
  properties: {
    tenantId: { type: 'string' },
  },
} as const;

export const verifyMfaChallengeBodyJson = {
  type: 'object',
  required: ['code'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit MFA code sent to email' },
  },
} as const;

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
}).refine((v) => Boolean(v.refreshToken || v.token), {
  message: 'Either refreshToken or token is required.',
}).transform((v) => ({
  refreshToken: v.refreshToken ?? v.token!,
}));

export const refreshBodyJson = {
  anyOf: [
    {
      type: 'object',
      required: ['refreshToken'],
      additionalProperties: false,
      properties: {
        refreshToken: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['token'],
      additionalProperties: false,
      properties: {
        token: { type: 'string' },
      },
    },
  ],
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type JoinViaInviteLinkBody = z.infer<typeof JoinViaInviteLinkBodySchema>;
export type StaffActivateBody = z.infer<typeof StaffActivateBodySchema>;
export type VerifyOtpBody = z.infer<typeof VerifyOtpBodySchema>;
export type ResendOtpBody = z.infer<typeof ResendOtpBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type CheckEmailQuery = z.infer<typeof CheckEmailQuerySchema>;
export type LogoutBody = z.infer<typeof LogoutBodySchema>;
export type SwitchTenantBody = z.infer<typeof SwitchTenantBodySchema>;
export type VerifyMfaChallengeBody = z.infer<typeof VerifyMfaChallengeBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
