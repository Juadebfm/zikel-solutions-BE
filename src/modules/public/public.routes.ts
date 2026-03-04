import type { FastifyPluginAsync } from 'fastify';
import * as publicService from './public.service.js';
import {
  BookDemoBodySchema,
  bookDemoBodyJson,
  JoinWaitlistBodySchema,
  joinWaitlistBodyJson,
  ContactUsBodySchema,
  contactUsBodyJson,
} from './public.schema.js';

const publicRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /public/book-demo ─────────────────────────────────────────────────
  fastify.post('/book-demo', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Public'],
      summary: 'Book a product demo',
      description:
        'Public endpoint — no authentication required. ' +
        'Accepts a demo request from the marketing website and stores it for the sales team. ' +
        'Rate-limited to 10 submissions per IP per 10 minutes.',
      security: [],
      body: bookDemoBodyJson,
      response: {
        201: {
          description: 'Demo request received.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'message'],
              properties: {
                id: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
        429: { description: 'Too many requests.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BookDemoBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const data = await publicService.bookDemo(parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // ── POST /public/join-waitlist ─────────────────────────────────────────────
  fastify.post('/join-waitlist', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Public'],
      summary: 'Join the product waitlist',
      description:
        'Public endpoint — no authentication required. ' +
        'Registers an email address on the waitlist for a specific service. ' +
        'Rate-limited to 10 submissions per IP per 10 minutes.',
      security: [],
      body: joinWaitlistBodyJson,
      response: {
        201: {
          description: 'Added to the waitlist.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'message'],
              properties: {
                id: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
        429: { description: 'Too many requests.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = JoinWaitlistBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const data = await publicService.joinWaitlist(parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });
  // ── POST /public/contact-us ────────────────────────────────────────────────
  fastify.post('/contact-us', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Public'],
      summary: 'Send a contact-us message',
      description:
        'Public endpoint — no authentication required. ' +
        'Accepts a contact message from the website and stores it for the team. ' +
        'Rate-limited to 10 submissions per IP per 10 minutes.',
      security: [],
      body: contactUsBodyJson,
      response: {
        201: {
          description: 'Message received.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'message'],
              properties: {
                id: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
        429: { description: 'Too many requests.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ContactUsBodySchema.safeParse(request.body);
      if (!parse.success) {
        const msg = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: msg },
        });
      }
      const data = await publicService.contactUs(parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });
};

export default publicRoutes;
