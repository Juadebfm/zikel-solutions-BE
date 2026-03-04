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
  .min(8, 'Minimum 8 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a special character');

// ─── Zod schemas (service layer) ──────────────────────────────────────────────

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
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const VerifyOtpBodySchema = z.object({
  userId: z.string().min(1),
  code: z.string().length(6, 'OTP must be exactly 6 digits'),
  // Restricted to email_verification only — password_reset OTPs are consumed by /reset-password
  purpose: z.literal('email_verification'),
});

export const ForgotPasswordBodySchema = z.object({
  email: z.email(),
});

export const ResetPasswordBodySchema = z
  .object({
    userId: z.string().min(1),
    code: z.string().length(6, 'OTP must be exactly 6 digits'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const ResendOtpBodySchema = z.object({
  userId: z.string().min(1),
  purpose: z.enum(['email_verification', 'password_reset']),
});

export const LoginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── JSON Schemas (route validation + OpenAPI) ────────────────────────────────

export const registerBodyJson = {
  type: 'object',
  required: ['country', 'firstName', 'lastName', 'email', 'password', 'confirmPassword', 'acceptTerms'],
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
      minLength: 8,
      description: 'Min 8 chars, must include uppercase, lowercase, number, and special character.',
    },
    confirmPassword: { type: 'string', minLength: 8 },
    acceptTerms: { type: 'boolean', enum: [true], description: 'Must be true to register.' },
  },
} as const;

export const verifyOtpBodyJson = {
  type: 'object',
  required: ['userId', 'code', 'purpose'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP sent to email' },
    purpose: { type: 'string', enum: ['email_verification'] },
  },
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
  required: ['userId', 'code', 'newPassword', 'confirmPassword'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP from forgot-password email' },
    newPassword: {
      type: 'string',
      minLength: 8,
      description: 'Min 8 chars, must include uppercase, lowercase, number, and special character.',
    },
    confirmPassword: { type: 'string', minLength: 8 },
  },
} as const;

export const resendOtpBodyJson = {
  type: 'object',
  required: ['userId', 'purpose'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    purpose: { type: 'string', enum: ['email_verification', 'password_reset'] },
  },
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

export const logoutBodyJson = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string' },
  },
} as const;

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const refreshBodyJson = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: { type: 'string' },
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegisterBody = z.infer<typeof RegisterBodySchema>;
export type VerifyOtpBody = z.infer<typeof VerifyOtpBodySchema>;
export type ResendOtpBody = z.infer<typeof ResendOtpBodySchema>;
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type LogoutBody = z.infer<typeof LogoutBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;
