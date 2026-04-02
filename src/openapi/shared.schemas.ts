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
  enum: ['super_admin', 'staff', 'manager', 'admin'],
} as const;

export const UserSchema = {
  $id: 'User',
  type: 'object',
  required: ['id', 'email', 'role', 'firstName', 'lastName', 'country', 'emailVerified', 'isActive', 'aiAccessEnabled', 'activeTenantId', 'createdAt'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { $ref: 'UserRole#' },
    firstName: { type: 'string' },
    middleName: { type: 'string', nullable: true },
    lastName: { type: 'string' },
    gender: { type: 'string', enum: ['male', 'female', 'other'], nullable: true },
    country: { type: 'string', enum: ['UK', 'Nigeria'] },
    phoneNumber: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
    language: { type: 'string', example: 'en' },
    timezone: { type: 'string', example: 'Europe/London' },
    emailVerified: { type: 'boolean' },
    acceptedTerms: { type: 'boolean' },
    isActive: { type: 'boolean' },
    aiAccessEnabled: { type: 'boolean' },
    activeTenantId: { type: 'string', nullable: true },
    lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const TokenPairSchema = {
  $id: 'TokenPair',
  type: 'object',
  required: ['accessToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    accessTokenExpiresAt: { type: 'string', format: 'date-time' },
    refreshTokenExpiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const AuthSessionExpirySchema = {
  $id: 'AuthSessionExpiry',
  type: 'object',
  required: ['idleExpiresAt', 'absoluteExpiresAt', 'warningWindowSeconds'],
  properties: {
    idleExpiresAt: { type: 'string', format: 'date-time' },
    absoluteExpiresAt: { type: 'string', format: 'date-time' },
    warningWindowSeconds: { type: 'integer', minimum: 0, example: 300 },
  },
} as const;

export const AuthSessionMembershipSchema = {
  $id: 'AuthSessionMembership',
  type: 'object',
  required: ['tenantId', 'tenantName', 'tenantSlug', 'tenantRole'],
  properties: {
    tenantId: { type: 'string' },
    tenantName: { type: 'string' },
    tenantSlug: { type: 'string' },
    tenantRole: { $ref: 'TenantRole#' },
  },
} as const;

export const AuthSessionSchema = {
  $id: 'AuthSession',
  type: 'object',
  required: ['activeTenantId', 'activeTenantRole', 'memberships', 'mfaRequired', 'mfaVerified'],
  properties: {
    activeTenantId: { type: 'string', nullable: true },
    activeTenantRole: {
      anyOf: [{ $ref: 'TenantRole#' }, { type: 'null' }],
    },
    memberships: {
      type: 'array',
      items: { $ref: 'AuthSessionMembership#' },
    },
    mfaRequired: { type: 'boolean' },
    mfaVerified: { type: 'boolean' },
  },
} as const;

export const AuthResponseSchema = {
  $id: 'AuthResponse',
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', enum: [true] },
    data: {
      type: 'object',
      required: ['user', 'tokens', 'session', 'serverTime'],
      properties: {
        user: { $ref: 'User#' },
        tokens: { $ref: 'TokenPair#' },
        session: {
          allOf: [{ $ref: 'AuthSession#' }, { $ref: 'AuthSessionExpiry#' }],
        },
        serverTime: { type: 'string', format: 'date-time' },
      },
    },
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

export const TenantRoleSchema = {
  $id: 'TenantRole',
  type: 'string',
  enum: ['tenant_admin', 'sub_admin', 'staff'],
} as const;

export const TenantSchema = {
  $id: 'Tenant',
  type: 'object',
  required: ['id', 'name', 'slug', 'country', 'isActive', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    country: { type: 'string', enum: ['UK', 'Nigeria'] },
    isActive: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const TenantMembershipSchema = {
  $id: 'TenantMembership',
  type: 'object',
  required: ['id', 'tenantId', 'userId', 'role', 'status', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    userId: { type: 'string' },
    role: { $ref: 'TenantRole#' },
    status: { type: 'string', enum: ['invited', 'active', 'suspended', 'revoked', 'pending_approval'] },
    invitedById: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const TenantInviteSchema = {
  $id: 'TenantInvite',
  type: 'object',
  required: [
    'id',
    'tenantId',
    'email',
    'role',
    'status',
    'invitedById',
    'acceptedByUserId',
    'expiresAt',
    'acceptedAt',
    'revokedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    email: { type: 'string', format: 'email' },
    role: { $ref: 'TenantRole#' },
    status: { type: 'string', enum: ['pending', 'accepted', 'revoked', 'expired'] },
    invitedById: { type: 'string' },
    acceptedByUserId: { type: 'string', nullable: true },
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: { type: 'string', format: 'date-time', nullable: true },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
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
    description: { type: 'string', nullable: true },
    address: { type: 'string', nullable: true },
    postCode: { type: 'string', nullable: true },
    capacity: { type: 'integer', nullable: true },
    category: { type: 'string', nullable: true },
    region: { type: 'string', nullable: true },
    status: { type: 'string', example: 'current' },
    phoneNumber: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    avatarFileId: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
    adminUserId: { type: 'string', nullable: true },
    personInChargeId: { type: 'string', nullable: true },
    responsibleIndividualId: { type: 'string', nullable: true },
    startDate: { type: 'string', format: 'date-time', nullable: true },
    endDate: { type: 'string', format: 'date-time', nullable: true },
    isSecure: { type: 'boolean' },
    shortTermStays: { type: 'boolean' },
    minAgeGroup: { type: 'integer', nullable: true },
    maxAgeGroup: { type: 'integer', nullable: true },
    ofstedUrn: { type: 'string', nullable: true },
    compliance: { nullable: true },
    details: { nullable: true },
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
    roleId: { type: 'string', nullable: true },
    jobTitle: { type: 'string', nullable: true },
    startDate: { type: 'string', format: 'date-time', nullable: true },
    endDate: { type: 'string', format: 'date-time', nullable: true },
    status: { type: 'string', example: 'current' },
    contractType: { type: 'string', nullable: true },
    dbsNumber: { type: 'string', nullable: true },
    dbsDate: { type: 'string', format: 'date-time', nullable: true },
    qualifications: { nullable: true },
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
    preferredName: { type: 'string', nullable: true },
    namePronunciation: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    dateOfBirth: { type: 'string', format: 'date', nullable: true },
    gender: { type: 'string', nullable: true },
    ethnicity: { type: 'string', nullable: true },
    religion: { type: 'string', nullable: true },
    referenceNo: { type: 'string', nullable: true },
    niNumber: { type: 'string', nullable: true },
    roomNumber: { type: 'string', nullable: true },
    status: { type: 'string', example: 'current' },
    type: { type: 'string', nullable: true },
    admissionDate: { type: 'string', format: 'date-time', nullable: true },
    placementEndDate: { type: 'string', format: 'date-time', nullable: true },
    avatarFileId: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', nullable: true },
    keyWorkerId: { type: 'string', nullable: true },
    practiceManagerId: { type: 'string', nullable: true },
    adminUserId: { type: 'string', nullable: true },
    socialWorkerName: { type: 'string', nullable: true },
    independentReviewingOfficer: { type: 'string', nullable: true },
    placingAuthority: { type: 'string', nullable: true },
    legalStatus: { type: 'string', nullable: true },
    isEmergencyPlacement: { type: 'boolean' },
    isAsylumSeeker: { type: 'boolean' },
    contact: { nullable: true },
    health: { nullable: true },
    education: { nullable: true },
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
    homeId: { type: 'string', nullable: true },
    registration: { type: 'string' },
    make: { type: 'string', nullable: true },
    model: { type: 'string', nullable: true },
    year: { type: 'integer', nullable: true },
    colour: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    status: { type: 'string', example: 'current' },
    vin: { type: 'string', nullable: true },
    registrationDate: { type: 'string', format: 'date-time', nullable: true },
    taxDate: { type: 'string', format: 'date-time', nullable: true },
    fuelType: { type: 'string', nullable: true },
    insuranceDate: { type: 'string', format: 'date-time', nullable: true },
    ownership: { type: 'string', nullable: true },
    leaseStartDate: { type: 'string', format: 'date-time', nullable: true },
    leaseEndDate: { type: 'string', format: 'date-time', nullable: true },
    purchasePrice: { type: 'number', nullable: true },
    purchaseDate: { type: 'string', format: 'date-time', nullable: true },
    startDate: { type: 'string', format: 'date-time', nullable: true },
    endDate: { type: 'string', format: 'date-time', nullable: true },
    adminUserId: { type: 'string', nullable: true },
    contactPhone: { type: 'string', nullable: true },
    avatarFileId: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
    details: { nullable: true },
    isActive: { type: 'boolean' },
    nextServiceDue: { type: 'string', format: 'date-time', nullable: true },
    motDue: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Uploads ──────────────────────────────────────────────────────────────────

export const UploadedFileSchema = {
  $id: 'UploadedFile',
  type: 'object',
  required: [
    'id',
    'originalName',
    'contentType',
    'sizeBytes',
    'purpose',
    'status',
    'uploadedAt',
    'publicUrl',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    originalName: { type: 'string' },
    contentType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    purpose: {
      type: 'string',
      enum: ['signature', 'task_attachment', 'task_document', 'announcement_image', 'general'],
    },
    status: { type: 'string', enum: ['pending', 'uploaded', 'failed'] },
    checksumSha256: { type: 'string', nullable: true },
    uploadedAt: { type: 'string', format: 'date-time', nullable: true },
    publicUrl: { type: 'string', format: 'uri', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const TaskReferenceSchema = {
  $id: 'TaskReference',
  type: 'object',
  required: ['id', 'type', 'entityType', 'entityId', 'fileId', 'url', 'label', 'metadata', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    type: {
      type: 'string',
      enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
    },
    entityType: {
      type: 'string',
      nullable: true,
      enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task', null],
    },
    entityId: { type: 'string', nullable: true },
    fileId: { type: 'string', nullable: true },
    url: { type: 'string', nullable: true },
    label: { type: 'string', nullable: true },
    metadata: { nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const TaskSchema = {
  $id: 'Task',
  type: 'object',
  required: ['id', 'title', 'status', 'approvalStatus', 'category', 'priority', 'references', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    taskRef: {
      type: 'string',
      description: 'Friendly display reference for UI usage.',
      example: 'TSK-20260321-HM5T7F',
    },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    category: {
      type: 'string',
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other', 'daily_log'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    dueDate: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    approvedAt: { type: 'string', format: 'date-time', nullable: true },
    rejectionReason: { type: 'string', nullable: true },
    assigneeId: { type: 'string', nullable: true },
    approvedById: { type: 'string', nullable: true },
    homeId: { type: 'string', nullable: true },
    vehicleId: { type: 'string', nullable: true },
    youngPersonId: { type: 'string', nullable: true },
    createdById: { type: 'string', nullable: true },
    formTemplateKey: { type: 'string', nullable: true },
    formName: { type: 'string', nullable: true },
    formGroup: { type: 'string', nullable: true },
    submissionPayload: { nullable: true },
    signatureFileId: { type: 'string', nullable: true },
    references: { type: 'array', items: { $ref: 'TaskReference#' } },
    submittedAt: { type: 'string', format: 'date-time', nullable: true },
    submittedById: { type: 'string', nullable: true },
    updatedById: { type: 'string', nullable: true },
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

// ─── Dashboard Widgets ────────────────────────────────────────────────────────

export const WidgetSchema = {
  $id: 'Widget',
  type: 'object',
  required: ['id', 'userId', 'title', 'period', 'reportsOn', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    title: { type: 'string', example: 'My Tasks This Month' },
    period: {
      type: 'string',
      example: 'this_month',
      description: 'Time window: last_7_days | last_30_days | this_month | this_year | all_time',
    },
    reportsOn: {
      type: 'string',
      example: 'tasks',
      description: 'Data source: tasks | approvals | young_people | employees',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

// ─── Summary Stats ────────────────────────────────────────────────────────────

export const SummaryStatsSchema = {
  $id: 'SummaryStats',
  type: 'object',
  required: [
    'overdue', 'dueToday', 'pendingApproval', 'rejected',
    'draft', 'future', 'comments', 'rewards',
  ],
  properties: {
    overdue: { type: 'integer', description: 'Tasks past their due date', example: 3 },
    dueToday: { type: 'integer', description: 'Tasks due today', example: 5 },
    pendingApproval: { type: 'integer', description: 'Tasks awaiting approval', example: 2 },
    rejected: { type: 'integer', description: 'Tasks rejected in review', example: 1 },
    draft: { type: 'integer', description: 'Tasks in draft state', example: 4 },
    future: { type: 'integer', description: 'Tasks scheduled in the future', example: 12 },
    comments: { type: 'integer', description: 'Unread announcements for the current user', example: 7 },
    rewards: { type: 'integer', description: 'Reward points derived from completed tasks', example: 120 },
  },
} as const;

// ─── Audit Logs ───────────────────────────────────────────────────────────────

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
        'record_created', 'record_accessed', 'record_updated', 'record_deleted', 'permission_changed',
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

export const ALL_SHARED_SCHEMAS = [
  ApiErrorSchema,
  PaginationMetaSchema,
  PaginatedQuerySchema,
  CuidParamSchema,
  UserRoleSchema,
  UserSchema,
  TenantRoleSchema,
  TokenPairSchema,
  AuthSessionExpirySchema,
  AuthSessionMembershipSchema,
  AuthSessionSchema,
  AuthResponseSchema,
  CareGroupSchema,
  TenantSchema,
  TenantMembershipSchema,
  TenantInviteSchema,
  HomeSchema,
  EmployeeSchema,
  YoungPersonSchema,
  VehicleSchema,
  TaskReferenceSchema,
  UploadedFileSchema,
  TaskSchema,
  AnnouncementSchema,
  WidgetSchema,
  SummaryStatsSchema,
  AuditLogSchema,
];
