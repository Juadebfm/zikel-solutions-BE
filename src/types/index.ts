// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'staff' | 'manager' | 'admin';
export type TenantRole = 'tenant_admin' | 'sub_admin' | 'staff';
export type PlatformRole = 'platform_admin' | 'support' | 'engineer' | 'billing';

// JWT audience: 'tenant' = care-home staff via /auth/*, 'platform' = Zikel staff via /admin/auth/*
export type JwtAudience = 'tenant' | 'platform';

export interface TenantJwtPayload {
  sub: string;       // tenantUser id
  email: string;
  role: UserRole;
  tenantId?: string | null;
  tenantRole?: TenantRole | null;
  mfaVerified?: boolean;
  sid?: string;      // session id (Phase 2)
  // Phase 5: when set, this token was minted by /admin/tenants/:id/impersonate.
  // The `sub` is the tenant Owner being impersonated; the real actor is this
  // PlatformUser id. Audit log writes are auto-stamped with it.
  impersonatorId?: string;
  impersonationGrantId?: string;
  aud: 'tenant';
  iat?: number;
  exp?: number;
}

export interface PlatformJwtPayload {
  sub: string;       // platformUser id
  email: string;
  role: PlatformRole;
  mfaVerified?: boolean;
  sid?: string;      // session id (Phase 2)
  aud: 'platform';
  iat?: number;
  exp?: number;
}

export type JwtPayload = TenantJwtPayload;

// ─── Response Envelope ────────────────────────────────────────────────────────

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Shared Query Params ──────────────────────────────────────────────────────

export interface PaginatedQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}
