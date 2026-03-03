/**
 * Shared JSON schemas — registered globally via fastify.addSchema().
 * Reference them in route schemas with { $ref: 'SchemaId#' }.
 *
 * Naming convention: PascalCase $id, mirrors TypeScript type names.
 */

// ─── Error ────────────────────────────────────────────────────────────────────

export const ApiErrorSchema = {
  $id: 'ApiError',
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string', example: 'Request body is invalid.' },
        details: {},
      },
    },
  },
} as const;

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationMetaSchema = {
  $id: 'PaginationMeta',
  type: 'object',
  required: ['total', 'page', 'pageSize', 'totalPages'],
  properties: {
    total: { type: 'integer', example: 42 },
    page: { type: 'integer', example: 1 },
    pageSize: { type: 'integer', example: 20 },
    totalPages: { type: 'integer', example: 3 },
  },
} as const;

// ─── Common query params ──────────────────────────────────────────────────────

export const PaginatedQuerySchema = {
  $id: 'PaginatedQuery',
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    sortBy: { type: 'string' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
    search: { type: 'string' },
  },
} as const;

// ─── Common field schemas ─────────────────────────────────────────────────────

export const CuidParamSchema = {
  $id: 'CuidParam',
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'CUID record identifier', example: 'clxyz1234abc' },
  },
} as const;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const UserRoleSchema = {
  $id: 'UserRole',
  type: 'string',
  enum: ['staff', 'manager', 'admin'],
} as const;

export const UserSchema = {
  $id: 'User',
  type: 'object',
  required: ['id', 'email', 'role', 'firstName', 'lastName', 'emailVerified', 'isActive', 'createdAt'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { $ref: 'UserRole#' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    phoneNumber: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
    emailVerified: { type: 'boolean' },
    isActive: { type: 'boolean' },
    lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const TokenPairSchema = {
  $id: 'TokenPair',
  type: 'object',
  required: ['accessToken', 'refreshToken'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
  },
} as const;

// ─── Care Groups ──────────────────────────────────────────────────────────────

export const CareGroupSchema = {
  $id: 'CareGroup',
  type: 'object',
  required: ['id', 'name', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Homes ────────────────────────────────────────────────────────────────────

export const HomeSchema = {
  $id: 'Home',
  type: 'object',
  required: ['id', 'careGroupId', 'name', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    careGroupId: { type: 'string' },
    name: { type: 'string' },
    address: { type: 'string', nullable: true },
    capacity: { type: 'integer', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Employees ────────────────────────────────────────────────────────────────

export const EmployeeSchema = {
  $id: 'Employee',
  type: 'object',
  required: ['id', 'userId', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    homeId: { type: 'string', nullable: true },
    jobTitle: { type: 'string', nullable: true },
    startDate: { type: 'string', format: 'date', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Young People ─────────────────────────────────────────────────────────────

export const YoungPersonSchema = {
  $id: 'YoungPerson',
  type: 'object',
  required: ['id', 'homeId', 'firstName', 'lastName', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    homeId: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    dateOfBirth: { type: 'string', format: 'date', nullable: true },
    referenceNo: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export const VehicleSchema = {
  $id: 'Vehicle',
  type: 'object',
  required: ['id', 'registration', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    registration: { type: 'string' },
    make: { type: 'string', nullable: true },
    model: { type: 'string', nullable: true },
    year: { type: 'integer', nullable: true },
    colour: { type: 'string', nullable: true },
    isActive: { type: 'boolean' },
    nextServiceDue: { type: 'string', format: 'date', nullable: true },
    motDue: { type: 'string', format: 'date', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const TaskSchema = {
  $id: 'Task',
  type: 'object',
  required: ['id', 'title', 'status', 'priority', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    dueDate: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    assigneeId: { type: 'string', nullable: true },
    youngPersonId: { type: 'string', nullable: true },
    createdById: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Announcements ────────────────────────────────────────────────────────────

export const AnnouncementSchema = {
  $id: 'Announcement',
  type: 'object',
  required: ['id', 'title', 'body', 'publishedAt', 'isPinned', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    publishedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    authorId: { type: 'string', nullable: true },
    isPinned: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Audit ────────────────────────────────────────────────────────────────────

export const AuditLogSchema = {
  $id: 'AuditLog',
  type: 'object',
  required: ['id', 'action', 'createdAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string', nullable: true },
    action: {
      type: 'string',
      enum: [
        'login', 'logout', 'register', 'password_change', 'otp_verified',
        'record_created', 'record_updated', 'record_deleted', 'permission_changed',
      ],
    },
    entityType: { type: 'string', nullable: true },
    entityId: { type: 'string', nullable: true },
    metadata: { nullable: true },
    ipAddress: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Registry ─────────────────────────────────────────────────────────────────
// Export as an array for easy iteration in the swagger plugin

export const ALL_SHARED_SCHEMAS = [
  ApiErrorSchema,
  PaginationMetaSchema,
  PaginatedQuerySchema,
  CuidParamSchema,
  UserRoleSchema,
  UserSchema,
  TokenPairSchema,
  CareGroupSchema,
  HomeSchema,
  EmployeeSchema,
  YoungPersonSchema,
  VehicleSchema,
  TaskSchema,
  AnnouncementSchema,
  AuditLogSchema,
];
