/**
 * Request/response schemas for /api/v1/generative/* endpoints.
 *
 * The generative module hosts AI-produced artifacts (daily-log summaries in
 * Phase 1; Reg 44/45 reports, safeguarding patterns, care-plan drafts in
 * later phases). All artifacts share the same draft -> edit -> commit
 * lifecycle backed by the `GenerativeArtifact` table.
 *
 * Schema shapes mirror the locked design in
 * docs/ai-phase-1-daily-log-summarisation.md.
 */

import { z } from 'zod';

// ─── Trigger: POST /api/v1/generative/daily-log-summary ─────────────────────

export const CreateDailyLogSummaryBodySchema = z
  .object({
    homeId: z.string().min(1),
    // ISO date 'YYYY-MM-DD'. We accept a date-only string and parse server-side
    // so timezone surprises don't shift which logs are summarised.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    // When true, supersede the existing draft/committed summary for this
    // {home, date}. When false (default), 409 if one exists.
    regenerate: z.boolean().optional().default(false),
  })
  .strict();

export type CreateDailyLogSummaryBody = z.infer<typeof CreateDailyLogSummaryBodySchema>;

export const createDailyLogSummaryBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: ['homeId', 'date'],
  properties: {
    homeId: { type: 'string', minLength: 1 },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    regenerate: { type: 'boolean' },
  },
} as const;

// ─── Edit: PATCH /api/v1/generative/artifacts/:id ───────────────────────────

// Daily-log summary content shape — locked in the build doc. Future
// artifactTypes will have their own shapes; for now this is the only one.
export const DailyLogSummaryContentSchema = z
  .object({
    shiftHighlights: z.array(z.string().min(1).max(500)).max(20),
    incidentsOfNote: z.array(z.string().min(1).max(500)).max(20),
    safeguardingFlags: z.array(z.string().min(1).max(500)).max(20),
    followUpRequired: z.array(z.string().min(1).max(500)).max(20),
    freeformSummary: z.string().min(1).max(4000),
    languageSafetyPassed: z.boolean(),
  })
  .strict();

export type DailyLogSummaryContent = z.infer<typeof DailyLogSummaryContentSchema>;

export const EditArtifactBodySchema = z
  .object({
    // The full new content. Sent as a complete replacement (not a delta) so the
    // edit-history diff is unambiguous.
    currentContent: DailyLogSummaryContentSchema,
    // Optimistic-concurrency token. Client must send the `updatedAt` from the
    // artifact it last saw. If the server's current `updatedAt` differs,
    // return 409 STALE_CONTENT.
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();

export type EditArtifactBody = z.infer<typeof EditArtifactBodySchema>;

export const editArtifactBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: ['currentContent', 'expectedUpdatedAt'],
  properties: {
    currentContent: {
      type: 'object',
      additionalProperties: false,
      required: [
        'shiftHighlights',
        'incidentsOfNote',
        'safeguardingFlags',
        'followUpRequired',
        'freeformSummary',
        'languageSafetyPassed',
      ],
      properties: {
        shiftHighlights: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 20 },
        incidentsOfNote: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 20 },
        safeguardingFlags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 20 },
        followUpRequired: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 20 },
        freeformSummary: { type: 'string', minLength: 1, maxLength: 4000 },
        languageSafetyPassed: { type: 'boolean' },
      },
    },
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Cuid path params ───────────────────────────────────────────────────────

export const ArtifactIdParamSchema = z.object({
  id: z.string().min(1),
});
