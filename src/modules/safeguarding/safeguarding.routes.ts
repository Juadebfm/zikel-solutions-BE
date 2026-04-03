import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import {
  addTherapeuticTelemetryMetrics,
  emitTherapeuticRouteTelemetry,
  enforceTherapeuticRouteAccess,
  readTherapeuticRouteConfig,
} from '../../lib/therapeutic-rollout.js';
import * as safeguardingService from './safeguarding.service.js';
import * as riskAlertService from './risk-alerts.service.js';
import * as patternsService from './patterns.service.js';
import {
  ChronologyQuerySchema,
  chronologyQueryJson,
  chronologyResponseJson,
  ReflectivePromptQuerySchema,
  SaveReflectivePromptResponsesBodySchema,
  reflectivePromptQueryJson,
  reflectivePromptResponseJson,
  saveReflectivePromptResponsesBodyJson,
  saveReflectivePromptResponsesResponseJson,
} from './safeguarding.schema.js';
import {
  IncidentPatternQuerySchema,
  incidentPatternQueryJson,
  incidentPatternsResponseJson,
} from './patterns.schema.js';
import {
  CreateRiskAlertNoteBodySchema,
  EvaluateRiskAlertsBodySchema,
  ListRiskAlertsQuerySchema,
  RiskAlertDetailQuerySchema,
  UpdateRiskAlertStateBodySchema,
  createRiskAlertNoteBodyJson,
  evaluateRiskAlertsBodyJson,
  riskAlertDetailQueryJson,
  listRiskAlertsQueryJson,
  riskAlertJson,
  riskRuleDefinitionJson,
  updateRiskAlertStateBodyJson,
} from './risk-alerts.schema.js';

const safeguardingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', async (request) => {
    const config = readTherapeuticRouteConfig(request);
    if (!config) return;
    await enforceTherapeuticRouteAccess(request, config);
  });
  fastify.addHook('onResponse', async (request, reply) => {
    const config = readTherapeuticRouteConfig(request);
    if (!config) return;
    emitTherapeuticRouteTelemetry(request, {
      statusCode: reply.statusCode,
      config,
    });
  });

  fastify.get('/chronology/young-people/:id', {
    config: {
      therapeuticModule: 'chronology',
      therapeuticAction: 'chronology_young_person_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Safeguarding chronology for a young person',
      description:
        'Builds an evidence-linked safeguarding chronology by merging incidents, daily logs, notes, approvals, tasks, home events, and key audit events for the young person scope.',
      params: { $ref: 'CuidParam#' },
      querystring: chronologyQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: chronologyResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ChronologyQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await safeguardingService.getYoungPersonChronology(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/chronology/homes/:id', {
    config: {
      therapeuticModule: 'chronology',
      therapeuticAction: 'chronology_home_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Safeguarding chronology for a home',
      description:
        'Builds an evidence-linked safeguarding chronology by merging incidents, daily logs, notes, approvals, tasks, home events, and key audit events for the selected home.',
      params: { $ref: 'CuidParam#' },
      querystring: chronologyQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: chronologyResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ChronologyQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await safeguardingService.getHomeChronology(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/patterns/young-people/:id', {
    config: {
      therapeuticModule: 'patterns',
      therapeuticAction: 'patterns_young_person_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Incident pattern mapping for a young person',
      description:
        'Builds normalized incident feature maps and returns frequency, cluster, recurrence, and co-occurrence patterns with explainability fields.',
      params: { $ref: 'CuidParam#' },
      querystring: incidentPatternQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: incidentPatternsResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = IncidentPatternQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await patternsService.getYoungPersonIncidentPatterns(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/patterns/homes/:id', {
    config: {
      therapeuticModule: 'patterns',
      therapeuticAction: 'patterns_home_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Incident pattern mapping for a home',
      description:
        'Builds normalized incident feature maps and returns frequency, cluster, recurrence, and co-occurrence patterns with explainability fields.',
      params: { $ref: 'CuidParam#' },
      querystring: incidentPatternQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: incidentPatternsResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = IncidentPatternQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await patternsService.getHomeIncidentPatterns(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/risk-alerts/rules', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alerts_rules_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'List safeguarding risk escalation rules',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: riskRuleDefinitionJson },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await riskAlertService.listRiskRules(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/reflective-prompts', {
    config: {
      therapeuticModule: 'reflective_prompts',
      therapeuticAction: 'reflective_prompts_view',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Get reflective recording prompts by form/task context',
      description:
        'Returns versioned reflective prompt sets with mandatory non-blaming prompts and context-specific prompt variants. ' +
        'Supports task-based context inference and rollout-aware payloads.',
      querystring: reflectivePromptQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: reflectivePromptResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ReflectivePromptQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await safeguardingService.getReflectivePromptSet(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/reflective-prompts/tasks/:id/responses', {
    config: {
      therapeuticModule: 'reflective_prompts',
      therapeuticAction: 'reflective_prompt_responses_save',
      therapeuticActionCompletion: true,
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Persist reflective prompt responses into task submission payload',
      description:
        'Saves therapeutic reflective responses in structured `submissionPayload` sections for audit and review workflows.',
      params: { $ref: 'CuidParam#' },
      body: saveReflectivePromptResponsesBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: saveReflectivePromptResponsesResponseJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SaveReflectivePromptResponsesBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const { id } = request.params as { id: string };
      const userId = (request.user as JwtPayload).sub;
      const data = await safeguardingService.saveReflectivePromptResponses(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/risk-alerts', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alerts_list',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'List safeguarding risk escalation alerts',
      querystring: listRiskAlertsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: riskAlertJson },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListRiskAlertsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const result = await riskAlertService.listRiskAlerts(userId, parse.data);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    },
  });

  fastify.get('/risk-alerts/:id', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alert_detail',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Get safeguarding risk escalation alert by id',
      params: { $ref: 'CuidParam#' },
      querystring: riskAlertDetailQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: riskAlertJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = RiskAlertDetailQuerySchema.safeParse(request.query ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const { id } = request.params as { id: string };
      const userId = (request.user as JwtPayload).sub;
      const data = await riskAlertService.getRiskAlert(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/risk-alerts/evaluate', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alerts_evaluate',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Run safeguarding risk evaluation (manual/scheduled backfill)',
      body: evaluateRiskAlertsBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: [
                'evaluatedAt',
                'mode',
                'lookbackHours',
                'totalCandidates',
                'createdCount',
                'reopenedCount',
                'updatedCount',
                'severityRaisedCount',
                'routedCount',
                'rules',
              ],
              properties: {
                evaluatedAt: { type: 'string', format: 'date-time' },
                mode: { type: 'string', enum: ['event', 'manual', 'scheduled'] },
                lookbackHours: { type: 'integer' },
                totalCandidates: { type: 'integer' },
                createdCount: { type: 'integer' },
                reopenedCount: { type: 'integer' },
                updatedCount: { type: 'integer' },
                severityRaisedCount: { type: 'integer' },
                routedCount: { type: 'integer' },
                rules: { type: 'array', items: riskRuleDefinitionJson },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = EvaluateRiskAlertsBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await riskAlertService.evaluateRiskAlerts(userId, parse.data);
      addTherapeuticTelemetryMetrics(request, {
        alertVolumeCount:
          (data.createdCount ?? 0)
          + (data.reopenedCount ?? 0)
          + (data.severityRaisedCount ?? 0),
        actionCompletionCount: data.updatedCount ?? 0,
      });
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/risk-alerts/:id/acknowledge', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alert_acknowledge',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Acknowledge safeguarding risk alert',
      params: { $ref: 'CuidParam#' },
      body: updateRiskAlertStateBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: riskAlertJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateRiskAlertStateBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await riskAlertService.acknowledgeRiskAlert(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/risk-alerts/:id/in-progress', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alert_in_progress',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Mark safeguarding risk alert in progress',
      params: { $ref: 'CuidParam#' },
      body: updateRiskAlertStateBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: riskAlertJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateRiskAlertStateBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await riskAlertService.markRiskAlertInProgress(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/risk-alerts/:id/resolve', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alert_resolve',
      therapeuticActionCompletion: true,
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Resolve safeguarding risk alert',
      params: { $ref: 'CuidParam#' },
      body: updateRiskAlertStateBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: riskAlertJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateRiskAlertStateBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await riskAlertService.resolveRiskAlert(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/risk-alerts/:id/notes', {
    config: {
      therapeuticModule: 'risk_alerts',
      therapeuticAction: 'risk_alert_note_add',
    },
    schema: {
      tags: ['Safeguarding'],
      summary: 'Add escalation note to safeguarding risk alert',
      params: { $ref: 'CuidParam#' },
      body: createRiskAlertNoteBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: riskAlertJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateRiskAlertNoteBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await riskAlertService.createRiskAlertNote(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default safeguardingRoutes;
