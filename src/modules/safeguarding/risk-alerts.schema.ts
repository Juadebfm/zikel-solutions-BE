import { z } from 'zod';

const BoolishSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return value;
}, z.boolean());

export const RiskAlertTypeSchema = z.enum([
  'high_severity_incident',
  'repeated_incident_pattern',
  'rejected_approval_spike',
  'overdue_high_priority_tasks',
  'critical_home_event_signal',
]);

export const RiskAlertSeveritySchema = z.enum(['medium', 'high', 'critical']);
export const RiskAlertStatusSchema = z.enum(['new', 'acknowledged', 'in_progress', 'resolved']);
export const RiskAlertTargetTypeSchema = z.enum(['tenant', 'home', 'young_person']);
export const RiskAlertConfidentialityScopeSchema = z.enum(['standard', 'restricted']);

export const ListRiskAlertsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: RiskAlertStatusSchema.optional(),
  severity: RiskAlertSeveritySchema.optional(),
  type: RiskAlertTypeSchema.optional(),
  targetType: RiskAlertTargetTypeSchema.optional(),
  targetId: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
  includeNotes: BoolishSchema.default(false),
  confidentialityScope: RiskAlertConfidentialityScopeSchema.optional(),
}).strict();

export const RiskAlertDetailQuerySchema = z.object({
  confidentialityScope: RiskAlertConfidentialityScopeSchema.optional(),
}).strict();

export const EvaluateRiskAlertsBodySchema = z.object({
  lookbackHours: z.coerce.number().int().min(1).max(24 * 90).default(24 * 7),
  homeId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  sendEmailHooks: BoolishSchema.default(false),
  mode: z.enum(['manual', 'scheduled']).default('manual'),
}).strict();

export const UpdateRiskAlertStateBodySchema = z.object({
  ownerUserId: z.string().min(1).nullable().optional(),
  note: z.string().trim().min(1).max(4000).optional(),
  sendEmailHooks: BoolishSchema.default(false),
}).strict();

export const CreateRiskAlertNoteBodySchema = z.object({
  note: z.string().trim().min(1).max(4000),
  isEscalation: BoolishSchema.default(false),
  sendEmailHooks: BoolishSchema.default(false),
}).strict();

const riskAlertTypeJson = ['high_severity_incident', 'repeated_incident_pattern', 'rejected_approval_spike', 'overdue_high_priority_tasks', 'critical_home_event_signal'] as const;
const riskAlertSeverityJson = ['medium', 'high', 'critical'] as const;
const riskAlertStatusJson = ['new', 'acknowledged', 'in_progress', 'resolved'] as const;
const riskAlertTargetTypeJson = ['tenant', 'home', 'young_person'] as const;
const riskAlertConfidentialityScopeJson = ['standard', 'restricted'] as const;

export const listRiskAlertsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: riskAlertStatusJson },
    severity: { type: 'string', enum: riskAlertSeverityJson },
    type: { type: 'string', enum: riskAlertTypeJson },
    targetType: { type: 'string', enum: riskAlertTargetTypeJson },
    targetId: { type: 'string' },
    ownerUserId: { type: 'string' },
    includeNotes: { type: 'boolean', default: false },
    confidentialityScope: { type: 'string', enum: riskAlertConfidentialityScopeJson },
  },
} as const;

export const riskAlertDetailQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confidentialityScope: { type: 'string', enum: riskAlertConfidentialityScopeJson },
  },
} as const;

export const evaluateRiskAlertsBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lookbackHours: { type: 'integer', minimum: 1, maximum: 2160, default: 168 },
    homeId: { type: 'string' },
    youngPersonId: { type: 'string' },
    sendEmailHooks: { type: 'boolean', default: false },
    mode: { type: 'string', enum: ['manual', 'scheduled'], default: 'manual' },
  },
} as const;

export const updateRiskAlertStateBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ownerUserId: { type: 'string', nullable: true },
    note: { type: 'string', minLength: 1, maxLength: 4000 },
    sendEmailHooks: { type: 'boolean', default: false },
  },
} as const;

export const createRiskAlertNoteBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: ['note'],
  properties: {
    note: { type: 'string', minLength: 1, maxLength: 4000 },
    isEscalation: { type: 'boolean', default: false },
    sendEmailHooks: { type: 'boolean', default: false },
  },
} as const;

export const riskRuleDefinitionJson = {
  type: 'object',
  required: ['key', 'name', 'description', 'defaultSeverity', 'windowHours', 'threshold'],
  properties: {
    key: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    defaultSeverity: { type: 'string', enum: riskAlertSeverityJson },
    windowHours: { type: 'integer' },
    threshold: { type: 'integer' },
  },
} as const;

export const riskAlertNoteJson = {
  type: 'object',
  required: ['id', 'alertId', 'tenantId', 'userId', 'note', 'isEscalation', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    alertId: { type: 'string' },
    tenantId: { type: 'string' },
    userId: { type: 'string' },
    note: { type: 'string' },
    isEscalation: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const riskAlertJson = {
  type: 'object',
  required: [
    'id',
    'tenantId',
    'type',
    'severity',
    'status',
    'targetType',
    'targetId',
    'homeId',
    'youngPersonId',
    'ruleKey',
    'dedupeKey',
    'title',
    'description',
    'evidence',
    'windowStart',
    'windowEnd',
    'firstTriggeredAt',
    'lastTriggeredAt',
    'triggeredCount',
    'ownerUserId',
    'acknowledgedById',
    'acknowledgedAt',
    'resolvedById',
    'resolvedAt',
    'lastEvaluatedAt',
    'createdAt',
    'updatedAt',
    'notes',
    'confidentialityScope',
  ],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    type: { type: 'string', enum: riskAlertTypeJson },
    severity: { type: 'string', enum: riskAlertSeverityJson },
    status: { type: 'string', enum: riskAlertStatusJson },
    targetType: { type: 'string', enum: riskAlertTargetTypeJson },
    targetId: { type: 'string' },
    homeId: { type: 'string', nullable: true },
    youngPersonId: { type: 'string', nullable: true },
    ruleKey: { type: 'string' },
    dedupeKey: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    evidence: {},
    windowStart: { type: 'string', format: 'date-time', nullable: true },
    windowEnd: { type: 'string', format: 'date-time', nullable: true },
    firstTriggeredAt: { type: 'string', format: 'date-time' },
    lastTriggeredAt: { type: 'string', format: 'date-time' },
    triggeredCount: { type: 'integer' },
    ownerUserId: { type: 'string', nullable: true },
    acknowledgedById: { type: 'string', nullable: true },
    acknowledgedAt: { type: 'string', format: 'date-time', nullable: true },
    resolvedById: { type: 'string', nullable: true },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true },
    lastEvaluatedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    notes: { type: 'array', items: riskAlertNoteJson },
    confidentialityScope: { type: 'string', enum: riskAlertConfidentialityScopeJson },
  },
} as const;

export type RiskAlertType = z.infer<typeof RiskAlertTypeSchema>;
export type RiskAlertSeverity = z.infer<typeof RiskAlertSeveritySchema>;
export type RiskAlertStatus = z.infer<typeof RiskAlertStatusSchema>;
export type RiskAlertTargetType = z.infer<typeof RiskAlertTargetTypeSchema>;
export type RiskAlertConfidentialityScope = z.infer<typeof RiskAlertConfidentialityScopeSchema>;
export type ListRiskAlertsQuery = z.infer<typeof ListRiskAlertsQuerySchema>;
export type RiskAlertDetailQuery = z.infer<typeof RiskAlertDetailQuerySchema>;
export type EvaluateRiskAlertsBody = z.infer<typeof EvaluateRiskAlertsBodySchema>;
export type UpdateRiskAlertStateBody = z.infer<typeof UpdateRiskAlertStateBodySchema>;
export type CreateRiskAlertNoteBody = z.infer<typeof CreateRiskAlertNoteBodySchema>;
