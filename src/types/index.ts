// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'staff' | 'manager' | 'admin';
export type TenantRole = 'tenant_admin' | 'sub_admin' | 'staff';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  tenantId?: string | null;
  tenantRole?: TenantRole | null;
  mfaVerified?: boolean;
  iat?: number;
  exp?: number;
}

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
