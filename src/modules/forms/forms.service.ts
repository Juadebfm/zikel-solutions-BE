import { AuditAction, MembershipStatus, Prisma, TenantRole, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { createTask } from '../tasks/tasks.service.js';
import type {
  CloneFormBody,
  CreateFormBody,
  FormAccessBody,
  FormBuilderBody,
  FormPreviewBody,
  FormSubmissionBody,
  FormTriggerBody,
  ListFormsQuery,
  UpdateFormBody,
} from './forms.schema.js';

type FormActorContext = {
  userId: string;
  tenantId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
  displayName: string;
};

type JsonRecord = Record<string, unknown>;

type FormTemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  group: string;
  schemaJson: Prisma.JsonValue;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const FORM_STATUS_SET = new Set(['draft', 'released', 'archived']);
const FORM_VISIBILITY_SET = new Set(['visible', 'hidden']);
const FORM_TYPE_SET = new Set([
  'home',
  'young_person',
  'school',
  'employee',
  'vehicle',
  'annual_leave',
  'care_group',
  'tenant',
  'other',
]);
const FORM_NOTIFICATION_MODE_SET = new Set(['users', 'roles']);
const FORM_ACKNOWLEDGEMENT_SET = new Set(['no', 'optional', 'mandatory']);
const FORM_SENSITIVITY_SET = new Set(['sensitive', 'not_sensitive']);

const FORM_TYPE_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'young_person', label: 'Young Person' },
  { value: 'school', label: 'School' },
  { value: 'employee', label: 'Employee' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'care_group', label: 'Care Group' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'other', label: 'Other' },
] as const;

const FIELD_PALETTE = [
  {
    category: 'layout',
    label: 'Layout',
    items: [
      { key: 'field_group_heading', label: 'Field Group Heading' },
      { key: 'multi_step_form_section', label: 'Multi Step Form Section' },
      { key: 'table', label: 'Table' },
    ],
  },
  {
    category: 'text',
    label: 'Text',
    items: [
      { key: 'numeric_input', label: 'Numeric Input' },
      { key: 'single_line_text_input', label: 'Single Line Text Input' },
      { key: 'multi_line_text_input', label: 'Multi Line Text Input' },
    ],
  },
  {
    category: 'multi_choice',
    label: 'Multi',
    items: [
      { key: 'true_or_false', label: 'True or False' },
      { key: 'yes_or_no', label: 'Yes or No' },
      { key: 'checkbox_list', label: 'CheckBox List' },
      { key: 'dropdown_select_list', label: 'Dropdown Select List' },
      { key: 'radio_buttons', label: 'Radio Buttons' },
      { key: 'system_list', label: 'System List' },
    ],
  },
  {
    category: 'datetime',
    label: 'Date',
    items: [
      { key: 'date_input', label: 'Date Input' },
      { key: 'override_date_input', label: 'Override Date Input' },
      { key: 'time_input', label: 'Time Input' },
    ],
  },
  {
    category: 'files',
    label: 'Files',
    items: [
      { key: 'inline_image', label: 'Inline Image' },
      { key: 'signature_image', label: 'Signature Image' },
      { key: 'image_editor', label: 'Image Editor' },
      { key: 'related_tasks', label: 'Related Tasks' },
      { key: 'embed_files', label: 'Embed Files' },
    ],
  },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => Boolean(entry));
}

function slugifyKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\//g, ' ')
    .replace(/\(/g, ' ')
    .replace(/\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function inferFormTypes(template: { key: string; group: string; name: string }) {
  const haystack = `${template.key} ${template.group} ${template.name}`.toLowerCase();
  const values: string[] = [];
  if (haystack.includes('young person') || haystack.includes('resident') || haystack.includes('yp')) {
    values.push('young_person');
  }
  if (haystack.includes('vehicle') || haystack.includes('car') || haystack.includes('transport')) {
    values.push('vehicle');
  }
  if (haystack.includes('home') || haystack.includes('house')) {
    values.push('home');
  }
  if (haystack.includes('employee') || haystack.includes('staff') || haystack.includes('manager')) {
    values.push('employee');
  }
  if (values.length === 0) values.push('other');
  return values.filter((value, index, list) => list.indexOf(value) === index);
}

function inferTaskCategory(template: { key: string; group: string; name: string }) {
  const haystack = `${template.key} ${template.group} ${template.name}`.toLowerCase();
  if (haystack.includes('incident')) return 'incident' as const;
  if (haystack.includes('policy') || haystack.includes('document')) return 'documentation' as const;
  if (haystack.includes('maintenance') || haystack.includes('vehicle')) return 'maintenance' as const;
  if (haystack.includes('inspection') || haystack.includes('audit')) return 'inspection' as const;
  if (haystack.includes('meeting')) return 'meeting' as const;
  if (haystack.includes('reg 44') || haystack.includes('reg44')) return 'reg44' as const;
  if (haystack.includes('compliance')) return 'compliance' as const;
  if (haystack.includes('report')) return 'report' as const;
  if (haystack.includes('reward')) return 'reward' as const;
  return 'general' as const;
}

function parseDelimitedValues(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is string => Boolean(value));
}

function resolveStatus(args: { designer: JsonRecord; isActive: boolean }) {
  const statusRaw = asString(args.designer.status);
  if (statusRaw && FORM_STATUS_SET.has(statusRaw)) return statusRaw;
  if (asString(args.designer.archivedAt)) return 'archived';
  return args.isActive ? 'released' : 'draft';
}

function resolveVisibility(designer: JsonRecord) {
  const visibilityRaw = asString(designer.visibility);
  if (visibilityRaw && FORM_VISIBILITY_SET.has(visibilityRaw)) return visibilityRaw;
  return asBoolean(designer.hidden, false) ? 'hidden' : 'visible';
}

function resolveNotifications(designer: JsonRecord) {
  const raw = asRecord(designer.notifications);
  const modeRaw = asString(raw?.mode, 'users') ?? 'users';
  return {
    mode: FORM_NOTIFICATION_MODE_SET.has(modeRaw) ? modeRaw : 'users',
    userIds: asStringArray(raw?.userIds),
    roles: asStringArray(raw?.roles),
  };
}

function resolveAccess(designer: JsonRecord) {
  const raw = asRecord(designer.access);
  const confidentialityModeRaw = asString(raw?.confidentialityMode, 'users') ?? 'users';
  const approverModeRaw = asString(raw?.approverMode, 'users') ?? 'users';
  return {
    confidentialityMode: FORM_NOTIFICATION_MODE_SET.has(confidentialityModeRaw)
      ? confidentialityModeRaw
      : 'users',
    confidentialityUserIds: asStringArray(raw?.confidentialityUserIds),
    confidentialityRoles: asStringArray(raw?.confidentialityRoles),
    approverMode: FORM_NOTIFICATION_MODE_SET.has(approverModeRaw) ? approverModeRaw : 'users',
    approverUserIds: asStringArray(raw?.approverUserIds),
    approverRoles: asStringArray(raw?.approverRoles),
  };
}

function resolveTriggerTask(designer: JsonRecord) {
  const raw = asRecord(designer.triggerTask);
  return {
    enabled: asBoolean(raw?.enabled, false),
    followUpFormId: asString(raw?.followUpFormId),
    allowUserChooseTriggerTime: asBoolean(raw?.allowUserChooseTriggerTime, false),
    alwaysTriggerSameProject: asBoolean(raw?.alwaysTriggerSameProject, false),
    restrictProjectByAssociation: asBoolean(raw?.restrictProjectByAssociation, false),
    restrictProjectByPermission: asBoolean(raw?.restrictProjectByPermission, false),
    allowCopyPreviousTaskData: asBoolean(raw?.allowCopyPreviousTaskData, false),
  };
}

function resolveBuilder(schemaJson: Prisma.JsonValue) {
  const root = asRecord(schemaJson) ?? {};
  const designer = asRecord(root.designer) ?? {};
  const builder = asRecord(designer.builder);

  if (builder) {
    return {
      version: typeof builder.version === 'number' && Number.isFinite(builder.version) ? builder.version : 1,
      sections: Array.isArray(builder.sections) ? builder.sections : [],
      fields: Array.isArray(builder.fields) ? builder.fields : [],
      ...builder,
    };
  }

  return {
    version: typeof root.version === 'number' && Number.isFinite(root.version) ? root.version : 1,
    sections: Array.isArray(root.sections) ? root.sections : [],
    fields: Array.isArray(root.fields) ? root.fields : [],
  };
}

function getDesigner(schemaJson: Prisma.JsonValue) {
  const root = asRecord(schemaJson) ?? {};
  return asRecord(root.designer) ?? {};
}

function getTemplateTenantId(row: { schemaJson: Prisma.JsonValue }) {
  const designer = getDesigner(row.schemaJson);
  return asString(designer.tenantId);
}

function mapFormTemplate(row: FormTemplateRow) {
  const designer = getDesigner(row.schemaJson);
  const builder = resolveBuilder(row.schemaJson);
  const status = resolveStatus({ designer, isActive: row.isActive });
  const visibility = resolveVisibility(designer);
  const requiresAcknowledgementRaw = asString(designer.requiresAcknowledgement, 'no') ?? 'no';
  const sensitivityRaw = asString(designer.defaultTaskSensitivity, 'not_sensitive') ?? 'not_sensitive';
  const formTypesRaw = asStringArray(designer.formTypes);
  const formTypes = formTypesRaw.length > 0
    ? formTypesRaw.filter((entry) => FORM_TYPE_SET.has(entry))
    : inferFormTypes(row);
  const templateTenantId = getTemplateTenantId(row);
  const instructions = asString(designer.instructions);

  return {
    id: row.id,
    key: row.key,
    namingConvention: row.key,
    name: row.name,
    description: row.description,
    instructions,
    status,
    visibility,
    hidden: visibility === 'hidden',
    formTypes,
    formGroup: row.group,
    group: row.group,
    keywords: asStringArray(designer.keywords),
    defaultTaskSensitivity: FORM_SENSITIVITY_SET.has(sensitivityRaw) ? sensitivityRaw : 'not_sensitive',
    isOneOff: asBoolean(designer.isOneOff, false),
    usableInProcedure: asBoolean(designer.usableInProcedure, false),
    requiresAcknowledgement: FORM_ACKNOWLEDGEMENT_SET.has(requiresAcknowledgementRaw)
      ? requiresAcknowledgementRaw
      : 'no',
    forceDisplayOnTrigger: asBoolean(designer.forceDisplayOnTrigger, false),
    notifications: resolveNotifications(designer),
    access: resolveAccess(designer),
    triggerTask: resolveTriggerTask(designer),
    builder,
    ownership: {
      tenantId: templateTenantId,
      scope: templateTenantId ? 'tenant' : 'global',
    },
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function sortForms(
  rows: ReturnType<typeof mapFormTemplate>[],
  sortBy: ListFormsQuery['sortBy'],
  sortOrder: ListFormsQuery['sortOrder'],
) {
  const direction = sortOrder === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    if (sortBy === 'group') return a.formGroup.localeCompare(b.formGroup) * direction;
    if (sortBy === 'status') return a.status.localeCompare(b.status) * direction;
    if (sortBy === 'createdAt') return (a.createdAt.getTime() - b.createdAt.getTime()) * direction;
    return (a.updatedAt.getTime() - b.updatedAt.getTime()) * direction;
  });
}

function isPrivilegedActor(actor: FormActorContext) {
  if (actor.userRole === UserRole.admin || actor.userRole === UserRole.manager) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function canReadTemplate(actor: FormActorContext, row: FormTemplateRow) {
  const templateTenantId = getTemplateTenantId(row);
  if (!templateTenantId) return true;
  return templateTenantId === actor.tenantId;
}

function canMutateTemplate(actor: FormActorContext, row: FormTemplateRow) {
  if (!isPrivilegedActor(actor)) return false;
  const templateTenantId = getTemplateTenantId(row);
  if (!templateTenantId) return false;
  return templateTenantId === actor.tenantId;
}

async function resolveActorContext(actorUserId: string): Promise<FormActorContext> {
  const tenant = await requireTenantContext(actorUserId);
  const user = await prisma.tenantUser.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, firstName: true, lastName: true },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return {
    userId: user.id,
    tenantId: tenant.tenantId,
    userRole: user.role,
    tenantRole: tenant.tenantRole,
    displayName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
  };
}

function ensurePrivileged(actor: FormActorContext) {
  if (isPrivilegedActor(actor)) return;
  throw httpError(403, 'FORBIDDEN', 'You do not have permission to manage forms.');
}

async function getTemplateOr404(id: string): Promise<FormTemplateRow> {
  const row = await prisma.formTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) throw httpError(404, 'FORM_NOT_FOUND', 'Form template not found.');
  return row;
}

function patchSchemaJson(args: {
  current: Prisma.JsonValue;
  updates?: JsonRecord;
  builder?: FormBuilderBody;
}) {
  const root: JsonRecord = { ...(asRecord(args.current) ?? {}) };
  const currentDesigner = asRecord(root.designer) ?? {};
  const nextDesigner: JsonRecord = { ...currentDesigner, ...(args.updates ?? {}) };

  if (args.builder) {
    nextDesigner.builder = args.builder as unknown as JsonRecord;
    root.version = args.builder.version;
    root.sections = args.builder.sections;
    root.fields = args.builder.fields;
    root.renderer = 'dynamic';
  }

  root.designer = nextDesigner;
  return root as Prisma.InputJsonValue;
}

async function logAudit(args: {
  actor: FormActorContext;
  action: AuditAction;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const data: Prisma.AuditLogCreateInput = {
    tenant: { connect: { id: args.actor.tenantId } },
    user: { connect: { id: args.actor.userId } },
    action: args.action,
    entityType: 'form_template',
    ...(args.entityId ? { entityId: args.entityId } : {}),
    ...(args.metadata ? { metadata: args.metadata as Prisma.InputJsonValue } : {}),
  };

  await prisma.auditLog.create({
    data,
  });
}

async function findUniqueKeyOrThrowConflict(key: string, ignoreId?: string) {
  const existing = await prisma.formTemplate.findUnique({
    where: { key },
    select: { id: true },
  });
  if (!existing) return;
  if (ignoreId && existing.id === ignoreId) return;
  throw httpError(409, 'FORM_KEY_EXISTS', 'A form with this naming convention already exists.');
}

function buildDesignerFromCreate(body: CreateFormBody, tenantId: string): JsonRecord {
  const visibility = body.visibility ?? (body.hidden ? 'hidden' : 'visible');
  const archivedAt = body.status === 'archived' ? new Date().toISOString() : null;
  return {
    tenantId,
    status: body.status,
    visibility,
    formTypes: body.formTypes,
    keywords: body.keywords,
    defaultTaskSensitivity: body.defaultTaskSensitivity,
    isOneOff: body.isOneOff,
    usableInProcedure: body.usableInProcedure,
    requiresAcknowledgement: body.requiresAcknowledgement,
    forceDisplayOnTrigger: body.forceDisplayOnTrigger,
    notifications: body.notifications,
    access: body.access,
    triggerTask: body.triggerTask,
    instructions: body.instructions ?? null,
    archivedAt,
  };
}

function buildDesignerPatchFromUpdate(body: UpdateFormBody): { updates: JsonRecord; builder?: FormBuilderBody } {
  const updates: JsonRecord = {};
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === 'archived') {
      updates.archivedAt = new Date().toISOString();
    } else if (body.status === 'draft' || body.status === 'released') {
      updates.archivedAt = null;
    }
  }
  if (body.visibility !== undefined) updates.visibility = body.visibility;
  if (body.hidden !== undefined) updates.visibility = body.hidden ? 'hidden' : 'visible';
  if (body.formTypes !== undefined) updates.formTypes = body.formTypes;
  if (body.keywords !== undefined) updates.keywords = body.keywords;
  if (body.defaultTaskSensitivity !== undefined) updates.defaultTaskSensitivity = body.defaultTaskSensitivity;
  if (body.isOneOff !== undefined) updates.isOneOff = body.isOneOff;
  if (body.usableInProcedure !== undefined) updates.usableInProcedure = body.usableInProcedure;
  if (body.requiresAcknowledgement !== undefined) updates.requiresAcknowledgement = body.requiresAcknowledgement;
  if (body.forceDisplayOnTrigger !== undefined) updates.forceDisplayOnTrigger = body.forceDisplayOnTrigger;
  if (body.notifications !== undefined) updates.notifications = body.notifications;
  if (body.access !== undefined) updates.access = body.access;
  if (body.triggerTask !== undefined) updates.triggerTask = body.triggerTask;
  if (body.instructions !== undefined) updates.instructions = body.instructions;

  return body.builder !== undefined
    ? { updates, builder: body.builder }
    : { updates };
}

function normalizeStatusToIsActive(status: string | undefined, fallback: boolean) {
  if (!status) return fallback;
  if (status === 'released') return true;
  return false;
}

export async function getFormsMetadata(actorUserId: string) {
  const actor = await resolveActorContext(actorUserId);
  const [templates, employees, membershipRoles] = await Promise.all([
    prisma.formTemplate.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        group: true,
        schemaJson: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    }),
    prisma.employee.findMany({
      where: { tenantId: actor.tenantId, isActive: true },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.tenantMembership.findMany({
      where: { tenantId: actor.tenantId, status: MembershipStatus.active },
      select: { role: { select: { name: true } } },
      distinct: ['roleId'],
      orderBy: { roleId: 'asc' },
    }),
  ]);

  const readableTemplates = templates.filter((row) => canReadTemplate(actor, row));
  const mapped = readableTemplates.map(mapFormTemplate);

  const groups = Array.from(new Set(mapped.map((row) => row.formGroup))).sort((a, b) => a.localeCompare(b));

  const roleValues = Array.from(new Set([
    ...membershipRoles.map((row) => row.role.name),
    TenantRole.tenant_admin,
    TenantRole.sub_admin,
    TenantRole.staff,
  ]));

  const users = employees.map((employee) => ({
    id: employee.userId,
    employeeId: employee.id,
    name: `${employee.user.firstName ?? ''} ${employee.user.lastName ?? ''}`.trim(),
    email: employee.user.email,
    avatarUrl: employee.user.avatarUrl,
  }));

  await logAudit({
    actor,
    action: AuditAction.record_accessed,
    metadata: { target: 'forms_metadata' },
  });

  return {
    formTypes: FORM_TYPE_OPTIONS,
    groups: groups.map((group) => ({ value: group, label: group })),
    fieldPalette: FIELD_PALETTE,
    statusOptions: [
      { value: 'draft', label: 'Draft' },
      { value: 'released', label: 'Released' },
      { value: 'archived', label: 'Archived' },
    ],
    sensitivityOptions: [
      { value: 'sensitive', label: 'Sensitive' },
      { value: 'not_sensitive', label: 'Not Sensitive' },
    ],
    acknowledgementOptions: [
      { value: 'no', label: 'No' },
      { value: 'optional', label: 'Optional' },
      { value: 'mandatory', label: 'Mandatory' },
    ],
    notificationModes: [
      { value: 'users', label: 'By Users' },
      { value: 'roles', label: 'By Roles' },
    ],
    roles: roleValues.map((role) => ({
      value: role,
      label:
        role === TenantRole.tenant_admin
          ? 'Tenant Admin'
          : role === TenantRole.sub_admin
            ? 'Sub Admin'
            : 'Staff',
    })),
    users,
    followUpForms: mapped.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      formGroup: row.formGroup,
      status: row.status,
    })),
  };
}

export async function listForms(actorUserId: string, query: ListFormsQuery) {
  const actor = await resolveActorContext(actorUserId);
  const typeFilters = parseDelimitedValues(query.type).filter((entry) => FORM_TYPE_SET.has(entry));
  const statusFilters = parseDelimitedValues(query.status).filter((entry) => FORM_STATUS_SET.has(entry));
  const search = query.search?.trim().toLowerCase();
  const groupFilter = query.group?.trim().toLowerCase();

  const dbWhere: Prisma.FormTemplateWhereInput = {
    ...(query.search
      ? {
          OR: [
            { key: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { group: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const rows = await prisma.formTemplate.findMany({
    where: dbWhere,
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const filtered = rows
    .filter((row) => canReadTemplate(actor, row))
    .map(mapFormTemplate)
    .filter((row) => {
      if (search) {
        const haystack = `${row.key} ${row.name} ${row.formGroup} ${row.description ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (groupFilter && row.formGroup.toLowerCase() !== groupFilter) return false;
      if (typeFilters.length > 0 && !row.formTypes.some((type) => typeFilters.includes(type))) return false;
      if (statusFilters.length > 0 && !statusFilters.includes(row.status)) return false;
      return true;
    });

  const sorted = sortForms(filtered, query.sortBy, query.sortOrder);
  const total = sorted.length;
  const skip = (query.page - 1) * query.pageSize;
  const data = sorted.slice(skip, skip + query.pageSize);

  await logAudit({
    actor,
    action: AuditAction.record_accessed,
    metadata: {
      target: 'forms_list',
      page: query.page,
      pageSize: query.pageSize,
      hasSearch: Boolean(query.search),
    },
  });

  return {
    data,
    meta: paginationMeta(total, query.page, query.pageSize),
  };
}

export async function getForm(actorUserId: string, formId: string) {
  const actor = await resolveActorContext(actorUserId);
  const row = await getTemplateOr404(formId);
  if (!canReadTemplate(actor, row)) {
    throw httpError(404, 'FORM_NOT_FOUND', 'Form template not found.');
  }

  await logAudit({
    actor,
    action: AuditAction.record_accessed,
    entityId: row.id,
    metadata: { target: 'form_detail' },
  });

  return mapFormTemplate(row);
}

export async function createFormTemplate(actorUserId: string, body: CreateFormBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);

  const desiredKey = (body.key ?? body.namingConvention ?? slugifyKey(body.name)).trim();
  if (!desiredKey) {
    throw httpError(422, 'VALIDATION_ERROR', 'Unable to derive naming convention for this form.');
  }
  await findUniqueKeyOrThrowConflict(desiredKey);

  const designer = buildDesignerFromCreate(body, actor.tenantId);
  const schemaJson = patchSchemaJson({
    current: {},
    updates: designer,
    builder: body.builder,
  });

  const row = await prisma.formTemplate.create({
    data: {
      key: desiredKey,
      name: body.name,
      description: body.description ?? null,
      group: body.formGroup,
      schemaJson,
      isActive: normalizeStatusToIsActive(body.status, false),
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_created,
    entityId: row.id,
    metadata: { key: row.key },
  });

  return mapFormTemplate(row);
}

export async function updateFormTemplate(actorUserId: string, formId: string, body: UpdateFormBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(
      403,
      'FORM_MUTATION_FORBIDDEN',
      'This form is global. Clone it first before editing in your tenant.',
    );
  }

  const nextKey = body.key ?? body.namingConvention;
  if (nextKey) await findUniqueKeyOrThrowConflict(nextKey, existing.id);
  const { updates, builder } = buildDesignerPatchFromUpdate(body);
  const schemaJson = patchSchemaJson(
    builder !== undefined
      ? {
          current: existing.schemaJson,
          updates,
          builder,
        }
      : {
          current: existing.schemaJson,
          updates,
        },
  );

  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: {
      ...(nextKey !== undefined ? { key: nextKey } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.formGroup !== undefined ? { group: body.formGroup } : {}),
      schemaJson,
      isActive: normalizeStatusToIsActive(body.status, existing.isActive),
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { fields: Object.keys(body) },
  });

  return mapFormTemplate(row);
}

function generateCloneKey(sourceKey: string) {
  const stamp = Math.random().toString(36).slice(2, 8);
  return slugifyKey(`${sourceKey}-copy-${stamp}`);
}

export async function cloneFormTemplate(actorUserId: string, formId: string, body: CloneFormBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const source = await getTemplateOr404(formId);
  if (!canReadTemplate(actor, source)) {
    throw httpError(404, 'FORM_NOT_FOUND', 'Form template not found.');
  }

  let nextKey = body.key ?? body.namingConvention ?? generateCloneKey(source.key);
  nextKey = nextKey.trim();
  if (!nextKey) nextKey = generateCloneKey(source.key);

  await findUniqueKeyOrThrowConflict(nextKey);

  const sourceDesigner = getDesigner(source.schemaJson);
  const sourceBuilder = resolveBuilder(source.schemaJson) as FormBuilderBody;
  const schemaJson = patchSchemaJson({
    current: source.schemaJson,
    updates: {
      ...sourceDesigner,
      tenantId: actor.tenantId,
      status: 'draft',
      archivedAt: null,
      visibility: resolveVisibility(sourceDesigner),
    },
    builder: sourceBuilder,
  });

  const row = await prisma.formTemplate.create({
    data: {
      key: nextKey,
      name: body.name ?? `${source.name} (Copy)`,
      description: source.description,
      group: source.group,
      schemaJson,
      isActive: false,
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_created,
    entityId: row.id,
    metadata: { sourceFormId: source.id, action: 'clone' },
  });

  return mapFormTemplate(row);
}

export async function publishFormTemplate(actorUserId: string, formId: string) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(
      403,
      'FORM_MUTATION_FORBIDDEN',
      'This form is global. Clone it first before publishing in your tenant.',
    );
  }

  const schemaJson = patchSchemaJson({
    current: existing.schemaJson,
    updates: {
      status: 'released',
      archivedAt: null,
    },
  });

  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: {
      isActive: true,
      schemaJson,
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { action: 'publish' },
  });

  return mapFormTemplate(row);
}

export async function archiveFormTemplate(actorUserId: string, formId: string) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(
      403,
      'FORM_MUTATION_FORBIDDEN',
      'This form is global. Clone it first before archiving in your tenant.',
    );
  }

  const schemaJson = patchSchemaJson({
    current: existing.schemaJson,
    updates: {
      status: 'archived',
      archivedAt: new Date().toISOString(),
    },
  });

  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: {
      isActive: false,
      schemaJson,
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { action: 'archive' },
  });

  return mapFormTemplate(row);
}

export async function updateFormBuilder(actorUserId: string, formId: string, body: FormBuilderBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(403, 'FORM_MUTATION_FORBIDDEN', 'This form cannot be modified in current tenant context.');
  }

  const schemaJson = patchSchemaJson({
    current: existing.schemaJson,
    updates: { status: resolveStatus({ designer: getDesigner(existing.schemaJson), isActive: existing.isActive }) },
    builder: body,
  });

  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: { schemaJson },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { action: 'builder_update' },
  });

  return mapFormTemplate(row);
}

export async function updateFormAccess(actorUserId: string, formId: string, body: FormAccessBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(403, 'FORM_MUTATION_FORBIDDEN', 'This form cannot be modified in current tenant context.');
  }

  const schemaJson = patchSchemaJson({
    current: existing.schemaJson,
    updates: { access: body },
  });
  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: { schemaJson },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { action: 'access_update' },
  });

  return mapFormTemplate(row);
}

export async function updateFormTrigger(actorUserId: string, formId: string, body: FormTriggerBody) {
  const actor = await resolveActorContext(actorUserId);
  ensurePrivileged(actor);
  const existing = await getTemplateOr404(formId);
  if (!canMutateTemplate(actor, existing)) {
    throw httpError(403, 'FORM_MUTATION_FORBIDDEN', 'This form cannot be modified in current tenant context.');
  }

  const schemaJson = patchSchemaJson({
    current: existing.schemaJson,
    updates: { triggerTask: body },
  });
  const row = await prisma.formTemplate.update({
    where: { id: existing.id },
    data: { schemaJson },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      group: true,
      schemaJson: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAudit({
    actor,
    action: AuditAction.record_updated,
    entityId: row.id,
    metadata: { action: 'trigger_update' },
  });

  return mapFormTemplate(row);
}

export async function previewForm(actorUserId: string, formId: string, body: FormPreviewBody) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await getTemplateOr404(formId);
  if (!canReadTemplate(actor, existing)) {
    throw httpError(404, 'FORM_NOT_FOUND', 'Form template not found.');
  }

  const mapped = mapFormTemplate(existing);
  const builder = body.builder ?? mapped.builder;
  const issues: string[] = [];

  if (!Array.isArray(builder.sections) || builder.sections.length === 0) {
    issues.push('Builder has no sections configured.');
  }
  if (!Array.isArray(builder.fields)) {
    issues.push('Builder `fields` must be an array.');
  }

  await logAudit({
    actor,
    action: AuditAction.record_accessed,
    entityId: existing.id,
    metadata: { action: 'preview', valid: issues.length === 0 },
  });

  return {
    form: {
      ...mapped,
      builder,
    },
    validation: {
      valid: issues.length === 0,
      issues,
    },
    render: {
      metadata: {
        id: mapped.id,
        key: mapped.key,
        name: mapped.name,
        description: mapped.description,
        instructions: mapped.instructions,
        status: mapped.status,
        visibility: mapped.visibility,
        formTypes: mapped.formTypes,
        formGroup: mapped.formGroup,
      },
      builder,
      sampleData: body.sampleData ?? null,
    },
  };
}

export async function submitForm(actorUserId: string, formId: string, body: FormSubmissionBody) {
  const actor = await resolveActorContext(actorUserId);
  const form = await getTemplateOr404(formId);
  if (!canReadTemplate(actor, form)) {
    throw httpError(404, 'FORM_NOT_FOUND', 'Form template not found.');
  }

  const mappedForm = mapFormTemplate(form);
  if (mappedForm.status !== 'released') {
    throw httpError(409, 'FORM_NOT_PUBLISHED', 'Only released forms can accept submissions.');
  }

  const payloadBase = asRecord(body.submissionPayload) ?? {};
  const submissionPayload = {
    ...payloadBase,
    form: {
      id: mappedForm.id,
      key: mappedForm.key,
      name: mappedForm.name,
      group: mappedForm.formGroup,
    },
    submittedVia: 'forms_api',
  };

  const approvalStatus = body.approvalStatus
    ?? (body.approverIds && body.approverIds.length > 0 ? 'pending_approval' : 'not_required');

  const task = await createTask(actorUserId, {
    title: body.title ?? `${mappedForm.name} Submission`,
    description: body.description ?? mappedForm.description ?? undefined,
    dueDate: body.dueAt,
    dueAt: body.dueAt,
    assigneeId: body.assigneeId,
    approverIds: body.approverIds,
    category: body.category ?? inferTaskCategory(form),
    type: body.type,
    relatedEntityId: body.relatedEntityId,
    homeId: body.homeId,
    vehicleId: body.vehicleId,
    youngPersonId: body.youngPersonId,
    priority: body.priority,
    status: body.status,
    approvalStatus,
    formTemplateKey: form.key,
    formName: form.name,
    formGroup: form.group,
    submissionPayload,
    references: body.references,
    signatureFileId: body.signatureFileId,
    attachmentFileIds: body.attachmentFileIds,
    submittedAt: body.submitNow ? new Date() : undefined,
  });

  await logAudit({
    actor,
    action: AuditAction.record_created,
    entityId: form.id,
    metadata: { action: 'form_submission', taskId: task.id },
  });

  return {
    formId: form.id,
    formKey: form.key,
    task,
  };
}
