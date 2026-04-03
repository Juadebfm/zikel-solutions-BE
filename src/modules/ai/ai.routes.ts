import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import * as aiService from './ai.service.js';
import {
  AskAiBodySchema,
  SetAiAccessBodySchema,
  askAiBodyJson,
  setAiAccessBodyJson,
} from './ai.schema.js';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.post('/ask', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI'],
      summary: 'Ask AI (page-aware assistant)',
      description:
        'Generates concise, page-aware guidance. On the summary page it uses system-wide stats; on other pages it uses the items and filters visible on screen. Returns provider output when available, with automatic fallback.',
      body: askAiBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['answer', 'suggestions', 'source', 'model', 'statsSource', 'generatedAt', 'minimalResponse', 'languageSafety', 'promptQa'],
              properties: {
                answer: { type: 'string' },
                suggestions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['label', 'action'],
                    properties: {
                      label: { type: 'string' },
                      action: { type: 'string' },
                    },
                  },
                },
                source: { type: 'string', enum: ['model', 'fallback'] },
                model: { type: ['string', 'null'] },
                statsSource: { type: 'string', enum: ['client', 'server', 'none'] },
                generatedAt: { type: 'string', format: 'date-time' },
                minimalResponse: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['enabled', 'headline', 'focusNow', 'nextLook', 'reassurance'],
                  properties: {
                    enabled: { type: 'boolean' },
                    headline: { type: 'string' },
                    focusNow: { type: 'array', items: { type: 'string' } },
                    nextLook: { type: ['string', 'null'] },
                    reassurance: { type: 'string' },
                  },
                },
                languageSafety: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['nonBlamingGuardrailsApplied', 'flaggedTerms', 'rubric'],
                  properties: {
                    nonBlamingGuardrailsApplied: { type: 'boolean' },
                    flaggedTerms: { type: 'array', items: { type: 'string' } },
                    rubric: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['version', 'passed', 'checks', 'notes'],
                      properties: {
                        version: { type: 'string', enum: ['pace-language-v1'] },
                        passed: { type: 'boolean' },
                        checks: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['nonBlamingLanguage', 'avoidsDiagnosisOrLegalConclusion', 'evidenceGrounded'],
                          properties: {
                            nonBlamingLanguage: { type: 'boolean' },
                            avoidsDiagnosisOrLegalConclusion: { type: 'boolean' },
                            evidenceGrounded: { type: 'boolean' },
                          },
                        },
                        notes: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
                promptQa: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['version', 'passed', 'checks', 'notes'],
                  properties: {
                    version: { type: 'string', enum: ['pace-language-v1'] },
                    passed: { type: 'boolean' },
                    checks: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['nonBlamingLanguage', 'avoidsDiagnosisOrLegalConclusion', 'evidenceGrounded'],
                      properties: {
                        nonBlamingLanguage: { type: 'boolean' },
                        avoidsDiagnosisOrLegalConclusion: { type: 'boolean' },
                        evidenceGrounded: { type: 'boolean' },
                      },
                    },
                    notes: { type: 'array', items: { type: 'string' } },
                  },
                },
                analysis: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['strengthProfile', 'responseMode', 'contextSummary', 'topPriorities', 'risks', 'missingData', 'quickActions', 'curiosity', 'platformSnapshot'],
                  properties: {
                    strengthProfile: { type: 'string', enum: ['owner', 'admin', 'staff'] },
                    responseMode: { type: 'string', enum: ['comprehensive', 'balanced', 'focused'] },
                    contextSummary: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['page', 'visibleItems', 'totalVisible', 'generatedFrom'],
                      properties: {
                        page: { type: 'string' },
                        visibleItems: { type: 'integer', minimum: 0 },
                        totalVisible: { type: ['integer', 'null'] },
                        generatedFrom: { type: 'string', enum: ['summary_stats', 'page_items'] },
                      },
                    },
                    topPriorities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['id', 'title', 'status', 'priority', 'category', 'type', 'dueDate', 'assignee', 'urgencyScore', 'urgencyLevel', 'reasons', 'recommendedAction'],
                        properties: {
                          id: { type: ['string', 'null'] },
                          title: { type: 'string' },
                          status: { type: ['string', 'null'] },
                          priority: { type: ['string', 'null'] },
                          category: { type: ['string', 'null'] },
                          type: { type: ['string', 'null'] },
                          dueDate: { type: ['string', 'null'] },
                          assignee: { type: ['string', 'null'] },
                          urgencyScore: { type: 'integer', minimum: 0, maximum: 100 },
                          urgencyLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                          reasons: { type: 'array', items: { type: 'string' } },
                          recommendedAction: { type: 'string' },
                        },
                      },
                    },
                    risks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['title', 'severity', 'reason'],
                        properties: {
                          title: { type: 'string' },
                          severity: { type: 'string', enum: ['medium', 'high', 'critical'] },
                          reason: { type: 'string' },
                        },
                      },
                    },
                    missingData: { type: 'array', items: { type: 'string' } },
                    quickActions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['label', 'action', 'reason'],
                        properties: {
                          label: { type: 'string' },
                          action: { type: 'string' },
                          reason: { type: 'string' },
                        },
                      },
                    },
                    curiosity: {
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
                    platformSnapshot: {
                      anyOf: [
                        {
                          type: 'object',
                          additionalProperties: false,
                          required: ['homes', 'careGroups', 'youngPeople', 'employees', 'vehicles', 'openTasks', 'pendingApprovals', 'overdueTasks', 'submittedDailyLogs', 'rejectedDailyLogs', 'openSupportTickets', 'unreadAnnouncements'],
                          properties: {
                            homes: { type: 'integer', minimum: 0 },
                            careGroups: { type: 'integer', minimum: 0 },
                            youngPeople: { type: 'integer', minimum: 0 },
                            employees: { type: 'integer', minimum: 0 },
                            vehicles: { type: 'integer', minimum: 0 },
                            openTasks: { type: 'integer', minimum: 0 },
                            pendingApprovals: { type: 'integer', minimum: 0 },
                            overdueTasks: { type: 'integer', minimum: 0 },
                            submittedDailyLogs: { type: 'integer', minimum: 0 },
                            rejectedDailyLogs: { type: 'integer', minimum: 0 },
                            openSupportTickets: { type: 'integer', minimum: 0 },
                            unreadAnnouncements: { type: 'integer', minimum: 0 },
                          },
                        },
                        { type: 'null' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = AskAiBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await aiService.askAi(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/access/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin', 'super_admin'],
        tenantRoles: ['tenant_admin'],
      }),
    ],
    schema: {
      tags: ['AI'],
      summary: 'Update AI access for a user (admin only)',
      description: 'Enables or disables AI access for a specific user account.',
      params: { $ref: 'CuidParam#' },
      body: setAiAccessBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'aiAccessEnabled', 'updatedAt'],
              properties: {
                userId: { type: 'string' },
                aiAccessEnabled: { type: 'boolean' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SetAiAccessBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await aiService.setUserAiAccess(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default aiRoutes;
