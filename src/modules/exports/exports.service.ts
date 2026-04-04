import { AuditAction, ExportJobEntity, ExportJobFormat, ExportJobStatus, Prisma, TaskCategory } from '@prisma/client';
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { CreateExportJobBody, ListExportJobsQuery } from './exports.schema.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function mapExportJobRow(row: Prisma.ExportJobGetPayload<object>) {
  return {
    id: row.id,
    entity: row.entity,
    format: row.format,
    status: row.status,
    errorMessage: row.errorMessage,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type ExportPayload = {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
};

async function buildExportPayload(tenantId: string, entity: ExportJobEntity, filters: Record<string, unknown>): Promise<ExportPayload> {
  const search = asString(filters.search);
  const dateFrom = asDate(filters.dateFrom);
  const dateTo = asDate(filters.dateTo);

  if (entity === ExportJobEntity.homes) {
    const where: Prisma.HomeWhereInput = { tenantId };
    const careGroupId = asString(filters.careGroupId);
    const isActive = typeof filters.isActive === 'boolean' ? filters.isActive : undefined;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { region: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (careGroupId) where.careGroupId = careGroupId;
    if (isActive !== undefined) where.isActive = isActive;

    const rows = await prisma.home.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { careGroup: { select: { name: true } } },
    });

    return {
      title: 'Homes Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Address', key: 'address', width: 180 },
        { header: 'Region', key: 'region', width: 90 },
        { header: 'Capacity', key: 'capacity', width: 60 },
        { header: 'Status', key: 'status', width: 70 },
        { header: 'Care Group', key: 'careGroupName', width: 110 },
      ],
      rows: rows.map((row) => ({
        name: row.name,
        address: row.address,
        region: row.region,
        capacity: row.capacity,
        status: row.status,
        careGroupName: row.careGroup?.name ?? null,
      })),
    };
  }

  if (entity === ExportJobEntity.employees) {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    const homeId = asString(filters.homeId);
    const status = asString(filters.status);
    if (homeId) where.homeId = homeId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { jobTitle: { contains: search, mode: 'insensitive' } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const rows = await prisma.employee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        home: { select: { name: true } },
        role: { select: { name: true } },
      },
    });

    return {
      title: 'Employees Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Email', key: 'email', width: 160 },
        { header: 'Home', key: 'home', width: 120 },
        { header: 'Role', key: 'role', width: 120 },
        { header: 'Job Title', key: 'jobTitle', width: 120 },
        { header: 'Status', key: 'status', width: 80 },
      ],
      rows: rows.map((row) => ({
        name: `${row.user.firstName ?? ''} ${row.user.lastName ?? ''}`.trim(),
        email: row.user.email,
        home: row.home?.name ?? null,
        role: row.role?.name ?? null,
        jobTitle: row.jobTitle,
        status: row.status,
      })),
    };
  }

  if (entity === ExportJobEntity.young_people) {
    const where: Prisma.YoungPersonWhereInput = { tenantId };
    const homeId = asString(filters.homeId);
    const status = asString(filters.status);
    if (homeId) where.homeId = homeId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { preferredName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.youngPerson.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { home: { select: { name: true } } },
    });

    return {
      title: 'Young People Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Preferred Name', key: 'preferredName', width: 120 },
        { header: 'Home', key: 'home', width: 120 },
        { header: 'Status', key: 'status', width: 80 },
        { header: 'Room Number', key: 'roomNumber', width: 80 },
      ],
      rows: rows.map((row) => ({
        name: `${row.firstName} ${row.lastName}`.trim(),
        preferredName: row.preferredName,
        home: row.home?.name ?? null,
        status: row.status,
        roomNumber: row.roomNumber,
      })),
    };
  }

  if (entity === ExportJobEntity.vehicles) {
    const where: Prisma.VehicleWhereInput = { tenantId };
    const homeId = asString(filters.homeId);
    const status = asString(filters.status);
    if (homeId) where.homeId = homeId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { registration: { contains: search, mode: 'insensitive' } },
        { make: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { home: { select: { name: true } } },
    });

    return {
      title: 'Vehicles Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Registration', key: 'registration', width: 100 },
        { header: 'Make', key: 'make', width: 100 },
        { header: 'Model', key: 'model', width: 100 },
        { header: 'Home', key: 'home', width: 120 },
        { header: 'Status', key: 'status', width: 80 },
      ],
      rows: rows.map((row) => ({
        registration: row.registration,
        make: row.make,
        model: row.model,
        home: row.home?.name ?? null,
        status: row.status,
      })),
    };
  }

  if (entity === ExportJobEntity.care_groups) {
    const where: Prisma.CareGroupWhereInput = { tenantId };
    const isActive = typeof filters.isActive === 'boolean' ? filters.isActive : undefined;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const rows = await prisma.careGroup.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { homes: { select: { id: true } } },
    });

    return {
      title: 'Care Groups Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Description', key: 'description', width: 200 },
        { header: 'Homes', key: 'homesCount', width: 70 },
        { header: 'Active', key: 'isActive', width: 70 },
      ],
      rows: rows.map((row) => ({
        name: row.name,
        description: row.description,
        homesCount: row.homes.length,
        isActive: row.isActive,
      })),
    };
  }

  if (entity === ExportJobEntity.tasks || entity === ExportJobEntity.daily_logs) {
    const where: Prisma.TaskWhereInput = {
      tenantId,
      deletedAt: null,
    };
    if (entity === ExportJobEntity.daily_logs) {
      where.category = TaskCategory.daily_log;
    }

    const category = asString(filters.category);
    const status = asString(filters.status);
    const approvalStatus = asString(filters.approvalStatus);
    const homeId = asString(filters.homeId);
    const assigneeId = asString(filters.assigneeId);

    if (category && entity !== ExportJobEntity.daily_logs) where.category = category as TaskCategory;
    if (status) where.status = status as never;
    if (approvalStatus) where.approvalStatus = approvalStatus as never;
    if (homeId) where.homeId = homeId;
    if (assigneeId) where.assigneeId = assigneeId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const rows = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        home: { select: { name: true } },
        assignee: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return {
      title: entity === ExportJobEntity.daily_logs ? 'Daily Logs Export' : 'Tasks Export',
      subtitle: 'Bulk export',
      columns: [
        { header: 'Title', key: 'title', width: 180 },
        { header: 'Category', key: 'category', width: 110 },
        { header: 'Status', key: 'status', width: 90 },
        { header: 'Approval Status', key: 'approvalStatus', width: 110 },
        { header: 'Priority', key: 'priority', width: 80 },
        { header: 'Home', key: 'home', width: 110 },
        { header: 'Assignee', key: 'assignee', width: 120 },
        { header: 'Created At', key: 'createdAt', width: 110 },
      ],
      rows: rows.map((row) => ({
        title: row.title,
        category: row.category,
        status: row.status,
        approvalStatus: row.approvalStatus,
        priority: row.priority,
        home: row.home?.name ?? null,
        assignee: row.assignee?.user
          ? `${row.assignee.user.firstName ?? ''} ${row.assignee.user.lastName ?? ''}`.trim()
          : null,
        createdAt: row.createdAt,
      })),
    };
  }

  const where: Prisma.AuditLogWhereInput = { tenantId };
  const action = asString(filters.action);
  const entityType = asString(filters.entityType);
  if (action) where.action = action as never;
  if (entityType) where.entityType = entityType;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = dateFrom;
    if (dateTo) where.createdAt.lte = dateTo;
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return {
    title: 'Audit Export',
    subtitle: 'Bulk export',
    columns: [
      { header: 'Action', key: 'action', width: 120 },
      { header: 'Entity Type', key: 'entityType', width: 120 },
      { header: 'Entity ID', key: 'entityId', width: 140 },
      { header: 'User', key: 'user', width: 150 },
      { header: 'IP Address', key: 'ipAddress', width: 100 },
      { header: 'Created At', key: 'createdAt', width: 120 },
    ],
    rows: rows.map((row) => ({
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      user: row.user ? `${row.user.firstName ?? ''} ${row.user.lastName ?? ''}`.trim() : null,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    })),
  };
}

export async function createExportJob(actorUserId: string, body: CreateExportJobBody) {
  const tenant = await requireTenantContext(actorUserId);

  const created = await prisma.exportJob.create({
    data: {
      tenantId: tenant.tenantId,
      createdById: actorUserId,
      entity: body.entity,
      filters: (body.filters ?? {}) as Prisma.InputJsonValue,
      format: body.format,
      status: ExportJobStatus.processing,
    },
  });

  try {
    await buildExportPayload(tenant.tenantId, created.entity, (created.filters ?? {}) as Record<string, unknown>);

    const completed = await prisma.exportJob.update({
      where: { id: created.id },
      data: {
        status: ExportJobStatus.completed,
        completedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_created,
        entityType: 'export_job',
        entityId: completed.id,
        metadata: {
          entity: completed.entity,
          format: completed.format,
        },
      },
    });

    return mapExportJobRow(completed);
  } catch (error) {
    await prisma.exportJob.update({
      where: { id: created.id },
      data: {
        status: ExportJobStatus.failed,
        errorMessage: error instanceof Error ? error.message : 'Failed to generate export payload.',
      },
    });

    throw httpError(422, 'EXPORT_BUILD_FAILED', 'Unable to prepare export with current filters.');
  }
}

export async function listExportJobs(actorUserId: string, query: ListExportJobsQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.ExportJobWhereInput = { tenantId: tenant.tenantId };
  if (query.status) where.status = query.status;

  const [total, rows] = await Promise.all([
    prisma.exportJob.count({ where }),
    prisma.exportJob.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    data: rows.map(mapExportJobRow),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getExportJob(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.exportJob.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });

  if (!row) {
    throw httpError(404, 'EXPORT_JOB_NOT_FOUND', 'Export job not found.');
  }

  return mapExportJobRow(row);
}

export async function downloadExportJob(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.exportJob.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });

  if (!row) {
    throw httpError(404, 'EXPORT_JOB_NOT_FOUND', 'Export job not found.');
  }

  if (row.status === ExportJobStatus.failed) {
    throw httpError(409, 'EXPORT_JOB_FAILED', row.errorMessage ?? 'Export job failed.');
  }

  const payload = await buildExportPayload(
    tenant.tenantId,
    row.entity,
    (row.filters ?? {}) as Record<string, unknown>,
  );

  const generated = await generateExport({
    title: payload.title,
    subtitle: payload.subtitle,
    columns: payload.columns,
    rows: payload.rows,
    format: row.format as ExportJobFormat,
  });

  if (row.status !== ExportJobStatus.completed) {
    await prisma.exportJob.update({
      where: { id: row.id },
      data: {
        status: ExportJobStatus.completed,
        completedAt: new Date(),
      },
    });
  }

  return generated;
}
