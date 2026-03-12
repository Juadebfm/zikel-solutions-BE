import fp from 'fastify-plugin';
import { timingSafeEqual } from 'crypto';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { TAGS } from '../openapi/tags.js';
import { ALL_SHARED_SCHEMAS } from '../openapi/shared.schemas.js';

export default fp(async (fastify) => {
  function unauthorized(reply: FastifyReply) {
    return reply
      .header('WWW-Authenticate', 'Basic realm="Zikel API Docs"')
      .status(401)
      .send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Swagger authentication required.',
        },
      });
  }

  function secureEquals(expected: string, provided: string) {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, providedBuffer);
  }

  async function enforceSwaggerBasicAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      return unauthorized(reply);
    }

    const encoded = authHeader.slice('Basic '.length).trim();
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      return unauthorized(reply);
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
      return unauthorized(reply);
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    const expectedUsername = env.SWAGGER_BASIC_AUTH_USERNAME;
    const expectedPassword = env.SWAGGER_BASIC_AUTH_PASSWORD;
    if (!expectedUsername || !expectedPassword) {
      return unauthorized(reply);
    }

    if (!secureEquals(expectedUsername, username) || !secureEquals(expectedPassword, password)) {
      return unauthorized(reply);
    }
  }

  // ── 1. Register shared schemas so routes can use { $ref: 'SchemaId#' } ──────
  for (const schema of ALL_SHARED_SCHEMAS) {
    fastify.addSchema(schema);
  }

  // ── 2. OpenAPI spec ──────────────────────────────────────────────────────────
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Zikel Solutions API',
        version: '0.1.0',
        description: `
**Zikel Solutions** care-management platform backend API.

## Authentication
All protected endpoints require a **Bearer token** obtained from \`POST /api/v1/auth/login\`.
Include it in every request:
\`\`\`
Authorization: Bearer <accessToken>
\`\`\`

## Response envelope
Every response is wrapped in a standard envelope:

**Success**
\`\`\`json
{ "success": true, "data": { ... }, "meta": { ...pagination } }
\`\`\`

**Error**
\`\`\`json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
\`\`\`

## Pagination
List endpoints accept \`page\`, \`pageSize\` (max 100), \`sortBy\`, \`sortOrder\`, and \`search\` query params.
        `.trim(),
        contact: {
          name: 'Zikel Solutions Engineering',
          email: 'engineering@zikel.dev',
        },
        license: {
          name: 'UNLICENSED',
        },
      },
      servers: [
        {
          url: `http://localhost:${env.PORT}`,
          description: 'Local development',
        },
        {
          url: 'https://zikel-solutions-staging.fly.dev',
          description: 'Staging (Fly.io)',
        },
        {
          url: 'https://zikel-solutions.fly.dev',
          description: 'Production (Fly.io)',
        },
      ],
      tags: TAGS.map((t) => ({ name: t.name, description: t.description })),
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token from POST /api/v1/auth/login',
          },
        },
      },
      // Default security applied to ALL routes — override per-route with security: []
      security: [{ BearerAuth: [] }],
    },
  });

  // ── 3. Swagger UI ─────────────────────────────────────────────────────────────
  if (env.SWAGGER_ENABLED) {
    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      ...(env.NODE_ENV === 'development'
        ? {}
        : {
            uiHooks: {
              onRequest: enforceSwaggerBasicAuth,
            },
          }),
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
      logo: {
        type: 'image/svg+xml',
        content: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <text y=".9em" font-size="90">Z</text>
           </svg>`,
        ).toString('base64'),
      },
    });

    fastify.log.info(`Swagger UI available at http://localhost:${env.PORT}/docs`);
  }
});
