/**
 * Shared helpers for routes that produce a logged-in tenant session response:
 *   - /auth/login
 *   - /auth/mfa/totp/verify
 *   - /auth/mfa/backup/verify
 *   - /auth/refresh
 *   - /auth/verify-otp (registration confirm)
 *   - /auth/staff-activate
 *   - /auth/switch-tenant
 *
 * Every route that issues a tenant access token + refresh-token cookie should
 * route through these so the response shape and security headers stay
 * synchronised across endpoints.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { parseExpiryMs } from '../../lib/tokens.js';
import type { JwtPayload } from '../../types/index.js';

const REFRESH_COOKIE_NAME = env.AUTH_REFRESH_COOKIE_NAME;
const REFRESH_COOKIE_SECURE = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
const REFRESH_COOKIE_DOMAIN = env.AUTH_REFRESH_COOKIE_DOMAIN;
const REFRESH_COOKIE_PATH = env.AUTH_REFRESH_COOKIE_PATH;
const REFRESH_COOKIE_SAME_SITE = env.AUTH_REFRESH_COOKIE_SAME_SITE;
const HINT_COOKIE_NAME = env.AUTH_HINT_COOKIE_NAME;
const HINT_COOKIE_DOMAIN = env.AUTH_HINT_COOKIE_DOMAIN;
const HINT_COOKIE_SECURE = REFRESH_COOKIE_SECURE;
const LEGACY_REFRESH_TOKEN_IN_BODY = env.AUTH_LEGACY_REFRESH_TOKEN_IN_BODY;
const ACCESS_TOKEN_EXPIRY_MS = parseExpiryMs(env.JWT_ACCESS_EXPIRY);
const SESSION_WARNING_WINDOW_SECONDS = env.SESSION_WARNING_WINDOW_SECONDS;

export function signTenantAccessToken(
  fastify: FastifyInstance,
  user: { id: string; email: string; role: JwtPayload['role'] },
  session: {
    activeTenantId: string | null;
    activeTenantRole: JwtPayload['tenantRole'];
    mfaVerified: boolean;
  },
  sessionId: string | null,
): string {
  return fastify.jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: session.activeTenantId,
    tenantRole: session.activeTenantRole ?? null,
    mfaVerified: session.mfaVerified,
    ...(sessionId ? { sid: sessionId } : {}),
    aud: 'tenant',
  });
}

export function setNoStoreHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

export function setAuthHintCookie(reply: FastifyReply, expiresAt: Date): void {
  reply.setCookie(HINT_COOKIE_NAME, '1', {
    httpOnly: false,
    secure: HINT_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    ...(HINT_COOKIE_DOMAIN ? { domain: HINT_COOKIE_DOMAIN } : {}),
    expires: expiresAt,
  });
}

export function clearAuthHintCookie(reply: FastifyReply): void {
  reply.clearCookie(HINT_COOKIE_NAME, {
    path: '/',
    ...(HINT_COOKIE_DOMAIN ? { domain: HINT_COOKIE_DOMAIN } : {}),
  });
}

export function setTenantRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  expiresAt: Date,
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: REFRESH_COOKIE_SECURE,
    sameSite: REFRESH_COOKIE_SAME_SITE,
    path: REFRESH_COOKIE_PATH,
    ...(REFRESH_COOKIE_DOMAIN ? { domain: REFRESH_COOKIE_DOMAIN } : {}),
    expires: expiresAt,
  });
  setAuthHintCookie(reply, expiresAt);
}

export function clearTenantRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_PATH,
    ...(REFRESH_COOKIE_DOMAIN ? { domain: REFRESH_COOKIE_DOMAIN } : {}),
  });
  clearAuthHintCookie(reply);
}

export function resolveTenantRefreshToken(
  request: FastifyRequest,
  bodyRefreshToken?: string,
): string | null {
  const cookieToken = request.cookies?.[REFRESH_COOKIE_NAME];
  return bodyRefreshToken ?? cookieToken ?? null;
}

export function buildTimedAuthResponse(args: {
  user: Record<string, unknown>;
  session: {
    activeTenantId: string | null;
    activeTenantRole: JwtPayload['tenantRole'];
    memberships: unknown[];
    mfaRequired: boolean;
    mfaVerified: boolean;
  };
  sessionExpiry: { idleExpiresAt: Date; absoluteExpiresAt: Date };
  accessToken: string;
  refreshToken?: string;
}) {
  const serverTime = new Date();
  const tokens: Record<string, string> = {
    accessToken: args.accessToken,
    accessTokenExpiresAt: new Date(serverTime.getTime() + ACCESS_TOKEN_EXPIRY_MS).toISOString(),
    refreshTokenExpiresAt: args.sessionExpiry.absoluteExpiresAt.toISOString(),
  };
  if (LEGACY_REFRESH_TOKEN_IN_BODY && args.refreshToken) {
    tokens.refreshToken = args.refreshToken;
  }
  return {
    user: args.user,
    session: {
      ...args.session,
      idleExpiresAt: args.sessionExpiry.idleExpiresAt.toISOString(),
      absoluteExpiresAt: args.sessionExpiry.absoluteExpiresAt.toISOString(),
      warningWindowSeconds: SESSION_WARNING_WINDOW_SECONDS,
    },
    tokens,
    serverTime: serverTime.toISOString(),
  };
}
