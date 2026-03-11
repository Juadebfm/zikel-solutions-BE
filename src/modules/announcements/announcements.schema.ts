import { z } from 'zod';

export const ListAnnouncementsQuerySchema = z.object({
  status: z.enum(['read', 'unread']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const baseAnnouncementBody = {
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  images: z.array(z.url()).max(10).optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  isPinned: z.boolean().optional(),
};

export const CreateAnnouncementBodySchema = z
  .object(baseAnnouncementBody)
  .refine(
    (v) =>
      !v.startsAt || !v.endsAt || new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
    {
      message: 'endsAt must be after startsAt.',
      path: ['endsAt'],
    },
  );

export const UpdateAnnouncementBodySchema = z
  .object({
    title: baseAnnouncementBody.title.optional(),
    description: baseAnnouncementBody.description.optional(),
    images: baseAnnouncementBody.images,
    startsAt: baseAnnouncementBody.startsAt,
    endsAt: baseAnnouncementBody.endsAt,
    isPinned: baseAnnouncementBody.isPinned,
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  })
  .refine(
    (v) =>
      !v.startsAt || !v.endsAt || new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
    {
      message: 'endsAt must be after startsAt.',
      path: ['endsAt'],
    },
  );

export const listAnnouncementsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['read', 'unread'] },
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const createAnnouncementBodyJson = {
  type: 'object',
  required: ['title', 'description'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 5000 },
    images: {
      type: 'array',
      items: { type: 'string', format: 'uri' },
      maxItems: 10,
    },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    isPinned: { type: 'boolean', default: false },
  },
} as const;

export const updateAnnouncementBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', minLength: 1, maxLength: 5000 },
    images: {
      type: 'array',
      items: { type: 'string', format: 'uri' },
      maxItems: 10,
    },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time' },
    isPinned: { type: 'boolean' },
  },
  minProperties: 1,
} as const;

export type ListAnnouncementsQuery = z.infer<typeof ListAnnouncementsQuerySchema>;
export type CreateAnnouncementBody = z.infer<typeof CreateAnnouncementBodySchema>;
export type UpdateAnnouncementBody = z.infer<typeof UpdateAnnouncementBodySchema>;
