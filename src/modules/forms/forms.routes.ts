import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as formsService from './forms.service.js';
import {
  CloneFormBodySchema,
  CreateFormBodySchema,
  FormAccessBodySchema,
  FormBuilderBodySchema,
  FormPreviewBodySchema,
  FormSubmissionBodySchema,
  FormTriggerBodySchema,
  ListFormsQuerySchema,
  UpdateFormBodySchema,
  cloneFormBodyJson,
  createFormBodyJson,
  formAccessBodyJson,
  formBuilderBodyJson,
  formPreviewBodyJson,
  formSubmissionBodyJson,
  formTriggerBodyJson,
  listFormsQueryJson,
  updateFormBodyJson,
} from './forms.schema.js';

const formsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/metadata', {
    schema: {
      tags: ['Forms'],
      summary: 'Get form designer metadata',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const data = await formsService.getFormsMetadata(actorUserId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/', {
    schema: {
      tags: ['Forms'],
      summary: 'List forms',
      querystring: listFormsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListFormsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data, meta } = await formsService.listForms(actorUserId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Forms'],
      summary: 'Get form by ID',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.getForm(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    schema: {
      tags: ['Forms'],
      summary: 'Create form',
      body: createFormBodyJson,
      response: {
        201: {
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
      const parse = CreateFormBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await formsService.createFormTemplate(actorUserId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    schema: {
      tags: ['Forms'],
      summary: 'Update form',
      params: { $ref: 'CuidParam#' },
      body: updateFormBodyJson,
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
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateFormBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.updateFormTemplate(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/clone', {
    schema: {
      tags: ['Forms'],
      summary: 'Clone form',
      params: { $ref: 'CuidParam#' },
      body: cloneFormBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CloneFormBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.cloneFormTemplate(actorUserId, id, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.post('/:id/publish', {
    schema: {
      tags: ['Forms'],
      summary: 'Publish form',
      params: { $ref: 'CuidParam#' },
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
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.publishFormTemplate(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/archive', {
    schema: {
      tags: ['Forms'],
      summary: 'Archive form',
      params: { $ref: 'CuidParam#' },
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
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.archiveFormTemplate(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/:id/builder', {
    schema: {
      tags: ['Forms'],
      summary: 'Update form builder schema',
      params: { $ref: 'CuidParam#' },
      body: formBuilderBodyJson,
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
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = FormBuilderBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.updateFormBuilder(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/:id/access', {
    schema: {
      tags: ['Forms'],
      summary: 'Update form access rules',
      params: { $ref: 'CuidParam#' },
      body: formAccessBodyJson,
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
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = FormAccessBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.updateFormAccess(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/:id/trigger', {
    schema: {
      tags: ['Forms'],
      summary: 'Update form trigger rules',
      params: { $ref: 'CuidParam#' },
      body: formTriggerBodyJson,
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
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = FormTriggerBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.updateFormTrigger(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/preview', {
    schema: {
      tags: ['Forms'],
      summary: 'Preview form',
      params: { $ref: 'CuidParam#' },
      body: formPreviewBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = FormPreviewBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.previewForm(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/submissions', {
    schema: {
      tags: ['Forms'],
      summary: 'Submit form',
      params: { $ref: 'CuidParam#' },
      body: formSubmissionBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = FormSubmissionBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await formsService.submitForm(actorUserId, id, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });
};

export default formsRoutes;
