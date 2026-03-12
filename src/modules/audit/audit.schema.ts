import { z } from 'zod';

export const ListAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z
    .enum([
      'login',
      'logout',
      'register',
      'password_change',
      'otp_verified',
      'record_created',
      'record_updated',
      'record_deleted',
      'permission_changed',
    ])
    .optional(),
  entityType: z.string().max(80).optional(),
  userId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  search: z.string().max(120).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export const BreakGlassAccessBodySchema = z.object({
  tenantId: z.string().min(1),
  reason: z.string().min(10).max(500),
  expiresInMinutes: z.coerce.number().int().min(5).max(120).default(30),
});

export const SecurityAlertsQuerySchema = z.object({
  lookbackHours: z.coerce.number().int().min(1).max(168).default(24),
});

export const listAuditLogsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    action: {
      type: 'string',
      enum: [
        'login',
        'logout',
        'register',
        'password_change',
        'otp_verified',
        'record_created',
        'record_updated',
        'record_deleted',
        'permission_changed',
      ],
    },
    entityType: { type: 'string', maxLength: 80 },
    userId: { type: 'string' },
    tenantId: { type: 'string' },
    search: { type: 'string', maxLength: 120 },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
  },
} as const;

export const breakGlassAccessBodyJson = {
  type: 'object',
  required: ['tenantId', 'reason'],
  additionalProperties: false,
  properties: {
    tenantId: { type: 'string' },
    reason: { type: 'string', minLength: 10, maxLength: 500 },
    expiresInMinutes: { type: 'integer', minimum: 5, maximum: 120, default: 30 },
  },
} as const;

export const securityAlertsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lookbackHours: { type: 'integer', minimum: 1, maximum: 168, default: 24 },
  },
} as const;

export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;
export type BreakGlassAccessBody = z.infer<typeof BreakGlassAccessBodySchema>;
export type SecurityAlertsQuery = z.infer<typeof SecurityAlertsQuerySchema>;
