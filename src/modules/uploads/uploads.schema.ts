import { UploadPurpose } from '@prisma/client';
import { z } from 'zod';

const checksumHexRe = /^[a-fA-F0-9]{64}$/;

export const UploadPurposeSchema = z.nativeEnum(UploadPurpose);

export const CreateUploadSessionBodySchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(120),
  sizeBytes: z.coerce.number().int().positive(),
  purpose: UploadPurposeSchema.default(UploadPurpose.general),
  checksumSha256: z
    .string()
    .regex(checksumHexRe, 'checksumSha256 must be a 64-char hex SHA-256 digest.')
    .optional(),
});

export const CompleteUploadBodySchema = z.object({
  expectedSizeBytes: z.coerce.number().int().positive().optional(),
});

export const createUploadSessionBodyJson = {
  type: 'object',
  required: ['fileName', 'contentType', 'sizeBytes'],
  additionalProperties: false,
  properties: {
    fileName: { type: 'string', minLength: 1, maxLength: 255 },
    contentType: { type: 'string', minLength: 3, maxLength: 120 },
    sizeBytes: { type: 'integer', minimum: 1 },
    purpose: {
      type: 'string',
      enum: ['signature', 'task_attachment', 'task_document', 'announcement_image', 'general'],
      default: 'general',
    },
    checksumSha256: {
      type: 'string',
      pattern: '^[a-fA-F0-9]{64}$',
      description: 'Optional SHA-256 checksum digest in hex.',
    },
  },
} as const;

export const completeUploadBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    expectedSizeBytes: { type: 'integer', minimum: 1 },
  },
} as const;

export type CreateUploadSessionBody = z.infer<typeof CreateUploadSessionBodySchema>;
export type CompleteUploadBody = z.infer<typeof CompleteUploadBodySchema>;
