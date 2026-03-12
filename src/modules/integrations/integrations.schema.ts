import { z } from 'zod';

const nullableObjectSchema = z.record(z.string(), z.unknown()).nullable();

const alertTypeSchema = z.enum([
  'repeated_auth_failures',
  'cross_tenant_attempts',
  'admin_changes',
  'break_glass_access',
]);

const alertSeveritySchema = z.enum(['medium', 'high']);

export const IngestSecurityAlertBodySchema = z
  .object({
    deliveryId: z.string().min(1),
    alert: z
      .object({
        type: alertTypeSchema,
        severity: alertSeveritySchema,
        details: z.string().min(1),
        context: nullableObjectSchema,
      })
      .strict(),
    source: z
      .object({
        auditLogId: z.string().min(1),
        action: z.string().min(1),
        entityType: z.string().min(1),
        entityId: z.string().min(1).nullable(),
        tenantId: z.string().min(1).nullable(),
        userId: z.string().min(1).nullable(),
        timestamp: z.iso.datetime(),
        metadata: nullableObjectSchema,
      })
      .strict(),
    emittedAt: z.iso.datetime(),
  })
  .strict();

export const ingestSecurityAlertBodyJson = {
  type: 'object',
  required: ['deliveryId', 'alert', 'source', 'emittedAt'],
  additionalProperties: false,
  properties: {
    deliveryId: { type: 'string', minLength: 1 },
    alert: {
      type: 'object',
      required: ['type', 'severity', 'details', 'context'],
      additionalProperties: false,
      properties: {
        type: {
          type: 'string',
          enum: ['repeated_auth_failures', 'cross_tenant_attempts', 'admin_changes', 'break_glass_access'],
        },
        severity: { type: 'string', enum: ['medium', 'high'] },
        details: { type: 'string', minLength: 1 },
        context: {
          anyOf: [
            { type: 'object', additionalProperties: true },
            { type: 'null' },
          ],
        },
      },
    },
    source: {
      type: 'object',
      required: ['auditLogId', 'action', 'entityType', 'entityId', 'tenantId', 'userId', 'timestamp', 'metadata'],
      additionalProperties: false,
      properties: {
        auditLogId: { type: 'string', minLength: 1 },
        action: { type: 'string', minLength: 1 },
        entityType: { type: 'string', minLength: 1 },
        entityId: { type: ['string', 'null'], minLength: 1 },
        tenantId: { type: ['string', 'null'], minLength: 1 },
        userId: { type: ['string', 'null'], minLength: 1 },
        timestamp: { type: 'string', format: 'date-time' },
        metadata: {
          anyOf: [
            { type: 'object', additionalProperties: true },
            { type: 'null' },
          ],
        },
      },
    },
    emittedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export type IngestSecurityAlertBody = z.infer<typeof IngestSecurityAlertBodySchema>;
