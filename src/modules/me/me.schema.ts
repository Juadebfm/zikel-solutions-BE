import { z } from 'zod';
import { passwordSchema } from '../auth/auth.schema.js';

export const UpdateMeBodySchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().min(7).max(20).optional(),
    avatar: z.string().max(2_000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const UpdatePreferencesBodySchema = z
  .object({
    language: z.string().min(2).max(10).optional(),
    timezone: z.string().min(2).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const updateMeBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    phone: { type: 'string', minLength: 7, maxLength: 20 },
    avatar: { type: ['string', 'null'], maxLength: 2000 },
  },
  minProperties: 1,
} as const;

export const changePasswordBodyJson = {
  type: 'object',
  required: ['currentPassword', 'newPassword', 'confirmPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', minLength: 1 },
    newPassword: {
      type: 'string',
      minLength: 8,
      description: 'Min 8 chars, must include uppercase, lowercase, number, and special character.',
    },
    confirmPassword: { type: 'string', minLength: 1 },
  },
} as const;

export const updatePreferencesBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', minLength: 2, maxLength: 10, example: 'en' },
    timezone: { type: 'string', minLength: 2, maxLength: 100, example: 'Europe/London' },
  },
  minProperties: 1,
} as const;

export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;
export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesBodySchema>;
