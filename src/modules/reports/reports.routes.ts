import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { generateExport } from '../../lib/export.js';
import {
  emitTherapeuticRouteTelemetry,
  enforceTherapeuticRouteAccess,
  readTherapeuticRouteConfig,
} from '../../lib/therapeutic-rollout.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import { requirePermission } from '../../middleware/rbac.js';
import { Permissions as P } from '../../auth/permissions.js';
import * as reportsService from './reports.service.js';
import {
  EvidencePackQuerySchema,
  evidencePackQueryJson,
  RiDashboardDrilldownQuerySchema,
  RiDashboardQuerySchema,
  riDashboardDrilldownQueryJson,
  riDashboardQueryJson,
} from './reports.schema.js';

const reportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', requireActiveSubscription);
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

  const reportsAccess = requirePermission(P.REPORTS_READ);

  fastify.get('/reg44-pack', {
    preHandler: [reportsAccess],
    config: {
      therapeuticModule: 'reg_packs',
      therapeuticAction: 'reports_reg44_pack',
    },
    schema: {
      tags: ['Reports'],
      summary: 'Generate Reg 44 evidence pack',
      description:
        'Returns structured Reg 44 evidence data for the selected tenant scope and date window. ' +
        'Supports JSON, PDF, Excel, and ZIP evidence-bundle output.',
      querystring: evidencePackQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = EvidencePackQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const pack = await reportsService.generateEvidencePack(userId, 'reg44', parse.data);

      if (parse.data.format === 'json') {
        return reply.send({ success: true, data: pack });
      }

      const exportSpec = reportsService.toEvidencePackExport(pack);
      if (parse.data.format === 'zip') {
        const [pdf, excel] = await Promise.all([
          generateExport({
            title: exportSpec.title,
            subtitle: exportSpec.subtitle,
            columns: exportSpec.columns,
            rows: exportSpec.rows,
            format: 'pdf',
          }),
          generateExport({
            title: exportSpec.title,
            subtitle: exportSpec.subtitle,
            columns: exportSpec.columns,
            rows: exportSpec.rows,
            format: 'excel',
          }),
        ]);
        const result = await reportsService.toEvidencePackZipBundle({ pack, pdf, excel });
        return reply
          .header('Content-Type', result.contentType)
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .send(result.buffer);
      }

      const result = await generateExport({
        title: exportSpec.title,
        subtitle: exportSpec.subtitle,
        columns: exportSpec.columns,
        rows: exportSpec.rows,
        format: parse.data.format,
      });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/reg45-pack', {
    preHandler: [reportsAccess],
    config: {
      therapeuticModule: 'reg_packs',
      therapeuticAction: 'reports_reg45_pack',
    },
    schema: {
      tags: ['Reports'],
      summary: 'Generate Reg 45 evidence pack',
      description:
        'Returns structured Reg 45 evidence data for the selected tenant scope and date window. ' +
        'Supports JSON, PDF, Excel, and ZIP evidence-bundle output.',
      querystring: evidencePackQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = EvidencePackQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const pack = await reportsService.generateEvidencePack(userId, 'reg45', parse.data);

      if (parse.data.format === 'json') {
        return reply.send({ success: true, data: pack });
      }

      const exportSpec = reportsService.toEvidencePackExport(pack);
      if (parse.data.format === 'zip') {
        const [pdf, excel] = await Promise.all([
          generateExport({
            title: exportSpec.title,
            subtitle: exportSpec.subtitle,
            columns: exportSpec.columns,
            rows: exportSpec.rows,
            format: 'pdf',
          }),
          generateExport({
            title: exportSpec.title,
            subtitle: exportSpec.subtitle,
            columns: exportSpec.columns,
            rows: exportSpec.rows,
            format: 'excel',
          }),
        ]);
        const result = await reportsService.toEvidencePackZipBundle({ pack, pdf, excel });
        return reply
          .header('Content-Type', result.contentType)
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .send(result.buffer);
      }

      const result = await generateExport({
        title: exportSpec.title,
        subtitle: exportSpec.subtitle,
        columns: exportSpec.columns,
        rows: exportSpec.rows,
        format: parse.data.format,
      });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/ri-dashboard', {
    preHandler: [reportsAccess],
    config: {
      therapeuticModule: 'ri_dashboard',
      therapeuticAction: 'reports_ri_dashboard_overview',
    },
    schema: {
      tags: ['Reports'],
      summary: 'RI monitoring dashboard (aggregate KPIs)',
      description:
        'Returns Responsible Individual monitoring KPIs with compliance, safeguarding, staffing, and completion signals. ' +
        'Supports JSON, PDF, and Excel export.',
      querystring: riDashboardQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = RiDashboardQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const dashboard = await reportsService.generateRiDashboard(userId, parse.data);
      if (parse.data.format === 'json') {
        return reply.send({ success: true, data: dashboard });
      }

      const exportSpec = reportsService.toRiDashboardOverviewExport(dashboard);
      const result = await generateExport({
        title: exportSpec.title,
        subtitle: exportSpec.subtitle,
        columns: exportSpec.columns,
        rows: exportSpec.rows,
        format: parse.data.format,
      });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/ri-dashboard/drilldown', {
    preHandler: [reportsAccess],
    config: {
      therapeuticModule: 'ri_dashboard',
      therapeuticAction: 'reports_ri_dashboard_drilldown',
    },
    schema: {
      tags: ['Reports'],
      summary: 'RI monitoring dashboard drilldown',
      description:
        'Returns paginated drilldown rows for a selected RI metric (compliance, safeguarding risk, staffing pressure, action completion). ' +
        'Supports JSON, PDF, and Excel export.',
      querystring: riDashboardDrilldownQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = RiDashboardDrilldownQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const drilldown = await reportsService.generateRiDashboardDrilldown(userId, parse.data);
      if (parse.data.format === 'json') {
        return reply.send({ success: true, data: drilldown });
      }

      const exportSpec = reportsService.toRiDashboardDrilldownExport(drilldown);
      const result = await generateExport({
        title: exportSpec.title,
        subtitle: exportSpec.subtitle,
        columns: exportSpec.columns,
        rows: exportSpec.rows,
        format: parse.data.format,
      });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });
};

export default reportsRoutes;
