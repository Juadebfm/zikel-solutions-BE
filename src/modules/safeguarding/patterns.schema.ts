import { z } from 'zod';

const DateInputSchema = z.union([z.string().datetime(), z.string().date()]);
export const IncidentPatternConfidentialityScopeSchema = z.enum(['standard', 'restricted']);

export const IncidentPatternQuerySchema = z
  .object({
    dateFrom: DateInputSchema.optional(),
    dateTo: DateInputSchema.optional(),
    confidentialityScope: IncidentPatternConfidentialityScopeSchema.optional(),
    maxIncidents: z.coerce.number().int().min(20).max(2000).default(500),
    minOccurrences: z.coerce.number().int().min(2).max(50).default(3),
    confidenceThreshold: z.coerce.number().min(0).max(1).default(0.55),
    maxPatterns: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dateFrom && value.dateTo) {
      const from = new Date(value.dateFrom);
      const to = new Date(value.dateTo);
      if (from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateFrom'],
          message: '`dateFrom` cannot be after `dateTo`.',
        });
      }
    }
  });

export const incidentPatternQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dateFrom: { type: 'string', description: 'ISO date or datetime (UTC).' },
    dateTo: { type: 'string', description: 'ISO date or datetime (UTC).' },
    confidentialityScope: { type: 'string', enum: ['standard', 'restricted'] },
    maxIncidents: { type: 'integer', minimum: 20, maximum: 2000, default: 500 },
    minOccurrences: { type: 'integer', minimum: 2, maximum: 50, default: 3 },
    confidenceThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.55 },
    maxPatterns: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

const incidentFeatureJson = {
  type: 'object',
  required: [
    'incidentId',
    'occurredAt',
    'dayOfWeek',
    'hourOfDay',
    'location',
    'triggerTags',
    'involvedRoles',
    'outcomes',
    'severity',
    'evidenceRef',
  ],
  properties: {
    incidentId: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    dayOfWeek: {
      type: 'string',
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    },
    hourOfDay: { type: 'integer', minimum: 0, maximum: 23 },
    location: {
      type: 'object',
      required: ['homeId', 'homeName', 'area'],
      properties: {
        homeId: { type: 'string', nullable: true },
        homeName: { type: 'string', nullable: true },
        area: { type: 'string', nullable: true },
      },
    },
    triggerTags: { type: 'array', items: { type: 'string' } },
    involvedRoles: { type: 'array', items: { type: 'string' } },
    outcomes: { type: 'array', items: { type: 'string' } },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    evidenceRef: {
      type: 'object',
      required: ['source', 'entityType', 'entityId', 'route'],
      properties: {
        source: { type: 'string', enum: ['tasks'] },
        entityType: { type: 'string', enum: ['task'] },
        entityId: { type: 'string' },
        route: { type: 'string' },
      },
    },
  },
} as const;

const incidentPatternSignalJson = {
  type: 'object',
  required: [
    'id',
    'patternType',
    'label',
    'metricCount',
    'confidence',
    'whyFlagged',
    'evidenceReferences',
    'relatedTags',
  ],
  properties: {
    id: { type: 'string' },
    patternType: { type: 'string', enum: ['frequency', 'cluster', 'recurrence', 'co_occurrence'] },
    label: { type: 'string' },
    metricCount: { type: 'integer' },
    confidence: { type: 'number' },
    whyFlagged: { type: 'string' },
    evidenceReferences: { type: 'array', items: { type: 'string' } },
    relatedTags: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const incidentPatternsResponseJson = {
  type: 'object',
  required: [
    'targetType',
    'target',
    'window',
    'retention',
    'confidentiality',
    'filtersApplied',
    'summary',
    'normalizedIncidents',
    'patterns',
    'insights',
  ],
  properties: {
    targetType: { type: 'string', enum: ['young_person', 'home'] },
    target: {
      type: 'object',
      required: ['id', 'name', 'homeId', 'homeName'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        homeId: { type: 'string', nullable: true },
        homeName: { type: 'string', nullable: true },
      },
    },
    window: {
      type: 'object',
      required: ['dateFrom', 'dateTo', 'timezone'],
      properties: {
        dateFrom: { type: 'string', format: 'date-time' },
        dateTo: { type: 'string', format: 'date-time' },
        timezone: { type: 'string', enum: ['UTC'] },
      },
    },
    retention: {
      type: 'object',
      required: ['policyDays', 'effectiveDateFrom', 'effectiveDateTo'],
      properties: {
        policyDays: { type: 'integer' },
        effectiveDateFrom: { type: 'string', format: 'date-time' },
        effectiveDateTo: { type: 'string', format: 'date-time' },
      },
    },
    confidentiality: {
      type: 'object',
      required: ['requestedScope', 'effectiveScope'],
      properties: {
        requestedScope: { type: 'string', enum: ['standard', 'restricted'] },
        effectiveScope: { type: 'string', enum: ['standard', 'restricted'] },
      },
    },
    filtersApplied: {
      type: 'object',
      required: ['confidentialityScope', 'maxIncidents', 'minOccurrences', 'confidenceThreshold', 'maxPatterns'],
      properties: {
        confidentialityScope: { type: 'string', enum: ['standard', 'restricted'] },
        maxIncidents: { type: 'integer' },
        minOccurrences: { type: 'integer' },
        confidenceThreshold: { type: 'number' },
        maxPatterns: { type: 'integer' },
      },
    },
    summary: {
      type: 'object',
      required: [
        'totalIncidents',
        'flaggedPatterns',
        'highConfidencePatterns',
        'latestIncidentAt',
        'uniqueTriggerTags',
      ],
      properties: {
        totalIncidents: { type: 'integer' },
        flaggedPatterns: { type: 'integer' },
        highConfidencePatterns: { type: 'integer' },
        latestIncidentAt: { type: 'string', format: 'date-time', nullable: true },
        uniqueTriggerTags: { type: 'integer' },
      },
    },
    normalizedIncidents: { type: 'array', items: incidentFeatureJson },
    patterns: {
      type: 'object',
      required: ['frequency', 'clusters', 'recurrence', 'coOccurrence'],
      properties: {
        frequency: { type: 'array', items: incidentPatternSignalJson },
        clusters: { type: 'array', items: incidentPatternSignalJson },
        recurrence: { type: 'array', items: incidentPatternSignalJson },
        coOccurrence: { type: 'array', items: incidentPatternSignalJson },
      },
    },
    insights: {
      type: 'object',
      additionalProperties: false,
      required: ['patternInsightSummaries', 'exploreNext'],
      properties: {
        patternInsightSummaries: { type: 'array', items: { type: 'string' } },
        exploreNext: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'reason', 'action'],
            properties: {
              label: { type: 'string' },
              reason: { type: 'string' },
              action: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;

export type IncidentPatternQuery = z.infer<typeof IncidentPatternQuerySchema>;
export type IncidentPatternConfidentialityScope = z.infer<typeof IncidentPatternConfidentialityScopeSchema>;
