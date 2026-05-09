import { z } from 'zod';

const DateInputSchema = z.union([z.string().datetime(), z.string().date()]);

const BooleanFromQuerySchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return value;
}, z.boolean());

export const ChronologyEventTypeSchema = z.enum([
  'incident',
  'daily_log',
  'note',
  'approval',
  'task',
  'home_event',
  'audit',
]);

export const ChronologySeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ChronologySourceSchema = z.enum(['tasks', 'home_events', 'audit_logs']);
export const ConfidentialityScopeSchema = z.enum(['standard', 'restricted']);

export const ReflectivePromptContextCategorySchema = z.enum([
  'incident',
  'daily_log',
  'general',
]);
export const ReflectivePromptIncidentTypeSchema = z.enum([
  'medication',
  'missing_from_home',
  'physical_intervention',
  'self_harm',
  'online_safety',
  'behaviour',
  'general_incident',
]);
export const ReflectivePromptChildProfileSchema = z.enum([
  'standard',
  'trauma_informed',
  'neurodivergent_support',
  'placement_transition',
]);
export const ReflectivePromptSafeguardingClassSchema = z.enum([
  'safeguarding_general',
  'behaviour_regulation',
  'missing_from_home',
  'medication_safety',
  'emotional_wellbeing',
  'physical_safety',
  'online_safety',
]);

export const ReflectivePromptQuerySchema = z
  .object({
    taskId: z.string().min(1).optional(),
    formTemplateKey: z.string().max(120).optional(),
    formGroup: z.string().max(120).optional(),
    contextCategory: ReflectivePromptContextCategorySchema.optional(),
    incidentType: ReflectivePromptIncidentTypeSchema.optional(),
    childProfile: ReflectivePromptChildProfileSchema.optional(),
    safeguardingClass: ReflectivePromptSafeguardingClassSchema.optional(),
    version: z.string().max(32).optional(),
    includeOptional: BooleanFromQuerySchema.default(true),
  })
  .strict();

export const ReflectivePromptResponseItemSchema = z.object({
  promptId: z.string().min(1).max(120),
  response: z.string().min(1).max(4000),
});

export const SaveReflectivePromptResponsesBodySchema = z
  .object({
    version: z.string().max(32).optional(),
    formTemplateKey: z.string().max(120).optional(),
    formGroup: z.string().max(120).optional(),
    contextCategory: ReflectivePromptContextCategorySchema.optional(),
    incidentType: ReflectivePromptIncidentTypeSchema.optional(),
    childProfile: ReflectivePromptChildProfileSchema.optional(),
    safeguardingClass: ReflectivePromptSafeguardingClassSchema.optional(),
    source: z.enum(['manual', 'ai_assist', 'imported']).default('manual'),
    responses: z.array(ReflectivePromptResponseItemSchema).min(1).max(40),
  })
  .strict();

export const ChronologyQuerySchema = z
  .object({
    dateFrom: DateInputSchema.optional(),
    dateTo: DateInputSchema.optional(),
    eventType: ChronologyEventTypeSchema.optional(),
    severity: ChronologySeveritySchema.optional(),
    source: ChronologySourceSchema.optional(),
    confidentialityScope: ConfidentialityScopeSchema.optional(),
    maxEvents: z.coerce.number().int().min(1).max(1000).default(200),
    // Phase 8.1 (2026-05-09): default flipped to false. Each chronology page
    // load was firing one OpenAI call by default — silently expensive at scale.
    // FE now opts in explicitly when the user wants the AI-generated narrative;
    // the deterministic fallback narrative is still always available client-side.
    includeNarrative: BooleanFromQuerySchema.default(false),
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

export const chronologyQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dateFrom: { type: 'string', description: 'ISO date or datetime (UTC).' },
    dateTo: { type: 'string', description: 'ISO date or datetime (UTC).' },
    eventType: {
      type: 'string',
      enum: ['incident', 'daily_log', 'note', 'approval', 'task', 'home_event', 'audit'],
    },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    source: { type: 'string', enum: ['tasks', 'home_events', 'audit_logs'] },
    confidentialityScope: { type: 'string', enum: ['standard', 'restricted'] },
    maxEvents: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    includeNarrative: { type: 'boolean', default: false },
  },
} as const;

export const chronologyEventJson = {
  type: 'object',
  required: [
    'id',
    'eventType',
    'source',
    'severity',
    'timestamp',
    'title',
    'description',
    'linkage',
    'evidenceRef',
  ],
  properties: {
    id: { type: 'string' },
    eventType: {
      type: 'string',
      enum: ['incident', 'daily_log', 'note', 'approval', 'task', 'home_event', 'audit'],
    },
    source: { type: 'string', enum: ['tasks', 'home_events', 'audit_logs'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    timestamp: { type: 'string', format: 'date-time' },
    title: { type: 'string' },
    description: { type: 'string' },
    linkage: {
      type: 'object',
      required: ['homeId', 'homeName', 'youngPersonId', 'youngPersonName'],
      properties: {
        homeId: { type: 'string', nullable: true },
        homeName: { type: 'string', nullable: true },
        youngPersonId: { type: 'string', nullable: true },
        youngPersonName: { type: 'string', nullable: true },
      },
    },
    evidenceRef: {
      type: 'object',
      required: ['source', 'entityType', 'entityId', 'route'],
      properties: {
        source: { type: 'string', enum: ['tasks', 'home_events', 'audit_logs'] },
        entityType: { type: 'string', enum: ['task', 'home_event', 'audit_log'] },
        entityId: { type: 'string' },
        taskId: { type: 'string', nullable: true },
        route: { type: 'string' },
      },
    },
  },
} as const;

export const chronologyResponseJson = {
  type: 'object',
  required: ['targetType', 'target', 'window', 'retention', 'confidentiality', 'filtersApplied', 'summary', 'chronology', 'narrative'],
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
      required: ['eventType', 'severity', 'source', 'confidentialityScope', 'maxEvents'],
      properties: {
        eventType: {
          type: 'string',
          nullable: true,
          enum: ['incident', 'daily_log', 'note', 'approval', 'task', 'home_event', 'audit', null],
        },
        severity: {
          type: 'string',
          nullable: true,
          enum: ['low', 'medium', 'high', 'critical', null],
        },
        source: { type: 'string', nullable: true, enum: ['tasks', 'home_events', 'audit_logs', null] },
        confidentialityScope: { type: 'string', enum: ['standard', 'restricted'] },
        maxEvents: { type: 'integer' },
      },
    },
    summary: {
      type: 'object',
      required: ['totalEvents', 'byType', 'bySeverity', 'bySource', 'earliestAt', 'latestAt'],
      properties: {
        totalEvents: { type: 'integer' },
        byType: { type: 'object', additionalProperties: { type: 'integer' } },
        bySeverity: { type: 'object', additionalProperties: { type: 'integer' } },
        bySource: { type: 'object', additionalProperties: { type: 'integer' } },
        earliestAt: { type: 'string', format: 'date-time', nullable: true },
        latestAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    chronology: { type: 'array', items: chronologyEventJson },
    narrative: {
      type: 'object',
      nullable: true,
      required: ['source', 'generatedAt', 'summary', 'keySignals', 'recommendedActions', 'evidenceReferences', 'qualityChecks'],
      properties: {
        source: { type: 'string', enum: ['model', 'fallback'] },
        generatedAt: { type: 'string', format: 'date-time' },
        summary: { type: 'string' },
        keySignals: { type: 'array', items: { type: 'string' } },
        recommendedActions: { type: 'array', items: { type: 'string' } },
        evidenceReferences: { type: 'array', items: { type: 'string' } },
        qualityChecks: {
          type: 'object',
          additionalProperties: false,
          required: ['version', 'childCentred', 'evidenceGrounded', 'nonBlamingLanguage', 'passed'],
          properties: {
            version: { type: 'string', enum: ['chronology-empathy-v1'] },
            childCentred: { type: 'boolean' },
            evidenceGrounded: { type: 'boolean' },
            nonBlamingLanguage: { type: 'boolean' },
            passed: { type: 'boolean' },
          },
        },
      },
    },
  },
} as const;

export const reflectivePromptQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string', minLength: 1 },
    formTemplateKey: { type: 'string', maxLength: 120 },
    formGroup: { type: 'string', maxLength: 120 },
    contextCategory: { type: 'string', enum: ['incident', 'daily_log', 'general'] },
    incidentType: {
      type: 'string',
      enum: ['medication', 'missing_from_home', 'physical_intervention', 'self_harm', 'online_safety', 'behaviour', 'general_incident'],
    },
    childProfile: {
      type: 'string',
      enum: ['standard', 'trauma_informed', 'neurodivergent_support', 'placement_transition'],
    },
    safeguardingClass: {
      type: 'string',
      enum: ['safeguarding_general', 'behaviour_regulation', 'missing_from_home', 'medication_safety', 'emotional_wellbeing', 'physical_safety', 'online_safety'],
    },
    version: { type: 'string', maxLength: 32 },
    includeOptional: { type: 'boolean', default: true },
  },
} as const;

const reflectivePromptJson = {
  type: 'object',
  required: ['id', 'text', 'category', 'mandatory', 'order', 'version'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    category: { type: 'string', enum: ['mandatory', 'incident_type', 'child_profile', 'safeguarding_class', 'general'] },
    mandatory: { type: 'boolean' },
    order: { type: 'integer' },
    version: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const reflectivePromptResponseJson = {
  type: 'object',
  required: ['promptSet', 'existingResponses'],
  properties: {
    promptSet: {
      type: 'object',
      required: [
        'key',
        'version',
        'rollout',
        'context',
        'prompts',
        'mandatoryPromptIds',
        'guidance',
        'generatedAt',
      ],
      properties: {
        key: { type: 'string' },
        version: { type: 'string' },
        rollout: {
          type: 'object',
          required: ['enabled', 'mode'],
          properties: {
            enabled: { type: 'boolean' },
            mode: { type: 'string', enum: ['all', 'incident_only', 'daily_log_only', 'off'] },
            reason: { type: ['string', 'null'] },
          },
        },
        context: {
          type: 'object',
          required: ['contextCategory', 'incidentType', 'childProfile', 'safeguardingClass'],
          properties: {
            taskId: { type: ['string', 'null'] },
            formTemplateKey: { type: ['string', 'null'] },
            formGroup: { type: ['string', 'null'] },
            contextCategory: { type: 'string', enum: ['incident', 'daily_log', 'general'] },
            incidentType: {
              type: 'string',
              enum: ['medication', 'missing_from_home', 'physical_intervention', 'self_harm', 'online_safety', 'behaviour', 'general_incident'],
            },
            childProfile: {
              type: 'string',
              enum: ['standard', 'trauma_informed', 'neurodivergent_support', 'placement_transition'],
            },
            safeguardingClass: {
              type: 'string',
              enum: ['safeguarding_general', 'behaviour_regulation', 'missing_from_home', 'medication_safety', 'emotional_wellbeing', 'physical_safety', 'online_safety'],
            },
          },
        },
        prompts: { type: 'array', items: reflectivePromptJson },
        mandatoryPromptIds: { type: 'array', items: { type: 'string' } },
        guidance: { type: 'array', items: { type: 'string' } },
        generatedAt: { type: 'string', format: 'date-time' },
      },
    },
    existingResponses: {
      type: 'array',
      items: {
        type: 'object',
        required: ['promptId', 'response'],
        properties: {
          promptId: { type: 'string' },
          response: { type: 'string' },
          answeredAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
    },
  },
} as const;

export const saveReflectivePromptResponsesBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: ['responses'],
  properties: {
    version: { type: 'string', maxLength: 32 },
    formTemplateKey: { type: 'string', maxLength: 120 },
    formGroup: { type: 'string', maxLength: 120 },
    contextCategory: { type: 'string', enum: ['incident', 'daily_log', 'general'] },
    incidentType: {
      type: 'string',
      enum: ['medication', 'missing_from_home', 'physical_intervention', 'self_harm', 'online_safety', 'behaviour', 'general_incident'],
    },
    childProfile: {
      type: 'string',
      enum: ['standard', 'trauma_informed', 'neurodivergent_support', 'placement_transition'],
    },
    safeguardingClass: {
      type: 'string',
      enum: ['safeguarding_general', 'behaviour_regulation', 'missing_from_home', 'medication_safety', 'emotional_wellbeing', 'physical_safety', 'online_safety'],
    },
    source: { type: 'string', enum: ['manual', 'ai_assist', 'imported'], default: 'manual' },
    responses: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['promptId', 'response'],
        properties: {
          promptId: { type: 'string', minLength: 1, maxLength: 120 },
          response: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
  },
} as const;

export const saveReflectivePromptResponsesResponseJson = {
  type: 'object',
  required: ['taskId', 'savedAt', 'reflectivePrompts'],
  properties: {
    taskId: { type: 'string' },
    savedAt: { type: 'string', format: 'date-time' },
    reflectivePrompts: {
      type: 'object',
      required: ['version', 'promptSetKey', 'source', 'context', 'responses', 'mandatoryPromptIds', 'mandatoryAnsweredCount', 'totalResponses'],
      properties: {
        version: { type: 'string' },
        promptSetKey: { type: 'string' },
        source: { type: 'string' },
        context: {
          type: 'object',
          additionalProperties: true,
        },
        responses: {
          type: 'array',
          items: {
            type: 'object',
            required: ['promptId', 'promptText', 'response', 'category', 'mandatory', 'answeredAt'],
            properties: {
              promptId: { type: 'string' },
              promptText: { type: 'string' },
              response: { type: 'string' },
              category: { type: 'string' },
              mandatory: { type: 'boolean' },
              answeredAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        mandatoryPromptIds: { type: 'array', items: { type: 'string' } },
        mandatoryAnsweredCount: { type: 'integer' },
        totalResponses: { type: 'integer' },
      },
    },
  },
} as const;

export type ChronologyQuery = z.infer<typeof ChronologyQuerySchema>;
export type ChronologyEventType = z.infer<typeof ChronologyEventTypeSchema>;
export type ChronologySeverity = z.infer<typeof ChronologySeveritySchema>;
export type ChronologySource = z.infer<typeof ChronologySourceSchema>;
export type ReflectivePromptQuery = z.infer<typeof ReflectivePromptQuerySchema>;
export type SaveReflectivePromptResponsesBody = z.infer<typeof SaveReflectivePromptResponsesBodySchema>;
export type ReflectivePromptContextCategory = z.infer<typeof ReflectivePromptContextCategorySchema>;
export type ReflectivePromptIncidentType = z.infer<typeof ReflectivePromptIncidentTypeSchema>;
export type ReflectivePromptChildProfile = z.infer<typeof ReflectivePromptChildProfileSchema>;
export type ReflectivePromptSafeguardingClass = z.infer<typeof ReflectivePromptSafeguardingClassSchema>;
export type ConfidentialityScope = z.infer<typeof ConfidentialityScopeSchema>;
