import { z } from 'zod';

export const UpdateOrganisationSettingsBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    timezone: z.string().min(1).max(120).optional(),
    locale: z.string().min(1).max(40).optional(),
    dateFormat: z.string().min(1).max(40).optional(),
    logoUrl: z.string().url().nullable().optional(),
    notificationDefaults: z.record(z.string(), z.unknown()).nullable().optional(),
    passwordPolicy: z.record(z.string(), z.unknown()).nullable().optional(),
    sessionTimeout: z.number().int().positive().nullable().optional(),
    mfaRequired: z.boolean().optional(),
    ipRestriction: z.record(z.string(), z.unknown()).nullable().optional(),
    dataRetentionDays: z.number().int().positive().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const UpdateSettingsNotificationsBodySchema = z
  .object({
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    digestFrequency: z.enum(['off', 'daily', 'weekly', 'monthly']).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const updateOrganisationSettingsBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    timezone: { type: 'string', minLength: 1, maxLength: 120 },
    locale: { type: 'string', minLength: 1, maxLength: 40 },
    dateFormat: { type: 'string', minLength: 1, maxLength: 40 },
    logoUrl: { type: ['string', 'null'], format: 'uri' },
    notificationDefaults: { type: ['object', 'null'], additionalProperties: true },
    passwordPolicy: { type: ['object', 'null'], additionalProperties: true },
    sessionTimeout: { type: ['integer', 'null'], minimum: 1 },
    mfaRequired: { type: 'boolean' },
    ipRestriction: { type: ['object', 'null'], additionalProperties: true },
    dataRetentionDays: { type: ['integer', 'null'], minimum: 1 },
  },
} as const;

export const updateSettingsNotificationsBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    emailNotifications: { type: 'boolean' },
    pushNotifications: { type: 'boolean' },
    digestFrequency: { type: 'string', enum: ['off', 'daily', 'weekly', 'monthly'] },
  },
} as const;

export type UpdateOrganisationSettingsBody = z.infer<typeof UpdateOrganisationSettingsBodySchema>;
export type UpdateSettingsNotificationsBody = z.infer<typeof UpdateSettingsNotificationsBodySchema>;
