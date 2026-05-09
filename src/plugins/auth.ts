import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';
import type { FastifyRequest } from 'fastify';
import type { JwtAudience, JwtPayload, PlatformJwtPayload } from '../types/index.js';
import { setRequestTenantId, setRequestImpersonatorId } from '../lib/request-context.js';
import { isImpersonationGrantActive } from '../modules/admin/impersonation.service.js';

const ISSUER = 'zikel-solutions';

function denyWrongAudience(audience: JwtAudience): never {
  const err = new Error('Token audience mismatch.') as Error & { statusCode?: number; code?: string };
  err.statusCode = 403;
  err.code = audience === 'platform' ? 'TENANT_TOKEN_REJECTED' : 'PLATFORM_TOKEN_REJECTED';
  throw err;
}

export default fp(async (fastify) => {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_ACCESS_EXPIRY,
      iss: ISSUER,
    },
    verify: {
      allowedIss: ISSUER,
    },
  });

  // Authenticate a tenant audience JWT (care-home staff via /auth/*).
  // Rejects tokens minted for the platform audience and propagates the
  // active tenantId into AsyncLocalStorage for the Prisma auto-scoping
  // extension to consume.
  fastify.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify<JwtPayload>();
    const payload = request.user as JwtPayload | undefined;
    if (payload?.aud !== 'tenant') denyWrongAudience('tenant');
    setRequestTenantId(payload?.tenantId ?? null);

    // Phase 5: if this is an impersonation token, fail-fast on revoked/expired
    // grants and propagate the impersonator id into the audit context so every
    // AuditLog.create call gets it auto-stamped.
    if (payload?.impersonatorId) {
      const grantId = payload.impersonationGrantId;
      if (grantId) {
        const active = await isImpersonationGrantActive(grantId);
        if (!active) {
          const err = new Error('Impersonation grant revoked or expired.') as Error & {
            statusCode?: number;
            code?: string;
          };
          err.statusCode = 401;
          err.code = 'IMPERSONATION_REVOKED';
          throw err;
        }
      }
      setRequestImpersonatorId(payload.impersonatorId);
    }
  });

  // Authenticate a platform audience JWT (Zikel internal staff via /admin/auth/*).
  // Rejects tokens minted for the tenant audience. Tenant auto-scoping stays
  // disabled (tenantId remains null) — platform routes operate cross-tenant
  // by design and must use `withUnscopedTenant(...)` for explicit access.
  fastify.decorate('authenticatePlatform', async (request: FastifyRequest) => {
    await request.jwtVerify<PlatformJwtPayload>();
    const aud = (request.user as { aud?: string } | undefined)?.aud;
    if (aud !== 'platform') denyWrongAudience('platform');
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: import('fastify').FastifyRequest): Promise<void>;
    authenticatePlatform(request: import('fastify').FastifyRequest): Promise<void>;
  }
}
