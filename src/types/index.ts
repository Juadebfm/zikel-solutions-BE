import type { FastifyRequest } from 'fastify';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'staff' | 'manager' | 'admin';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
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

// ─── Augment Fastify ──────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

// ─── Shared Query Params ──────────────────────────────────────────────────────

export interface PaginatedQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}
