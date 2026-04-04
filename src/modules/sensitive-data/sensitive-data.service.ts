import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
import type {
  CreateSensitiveDataBody,
  ListSensitiveDataQuery,
  UpdateSensitiveDataBody,
} from './sensitive-data.schema.js';

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function displayName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim();
}

function mapSensitiveDataRecord(
  row: Prisma.SensitiveDataRecordGetPayload<{
    include: {
      youngPerson: { select: { id: true; firstName: true; lastName: true; preferredName: true } };
      home: { select: { id: true; name: true } };
      createdBy: { select: { id: true; firstName: true; lastName: true; email: true } };
      updatedBy: { select: { id: true; firstName: true; lastName: true; email: true } };
    };
  }>,
) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    confidentialityScope: row.confidentialityScope,
    retentionDate: row.retentionDate,
    attachmentFileIds: row.attachmentFileIds,
    youngPerson: row.youngPerson
      ? {
          id: row.youngPerson.id,
          name: row.youngPerson.preferredName ?? displayName(row.youngPerson.firstName, row.youngPerson.lastName),
        }
      : null,
    home: row.home ? { id: row.home.id, name: row.home.name } : null,
    createdBy: {
      id: row.createdBy.id,
      name: displayName(row.createdBy.firstName, row.createdBy.lastName),
      email: row.createdBy.email,
    },
    updatedBy: row.updatedBy
      ? {
          id: row.updatedBy.id,
          name: displayName(row.updatedBy.firstName, row.updatedBy.lastName),
          email: row.updatedBy.email,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureYoungPersonInTenant(tenantId: string, youngPersonId: string | null | undefined) {
  if (!youngPersonId) return;
  const row = await prisma.youngPerson.findFirst({
    where: { id: youngPersonId, tenantId },
    select: { id: true },
  });
  if (!row) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }
}

async function ensureHomeInTenant(tenantId: string, homeId: string | null | undefined) {
  if (!homeId) return;
  const row = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!row) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

async function ensureAttachmentFilesInTenant(tenantId: string, fileIds: string[]) {
  if (fileIds.length === 0) return;
  await assertUploadedFilesBelongToTenant(tenantId, fileIds);
}

export async function listSensitiveDataRecords(actorUserId: string, query: ListSensitiveDataQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.SensitiveDataRecordWhereInput = {
    tenantId: tenant.tenantId,
    deletedAt: null,
  };

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { content: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.category) where.category = query.category;
  if (query.youngPersonId) where.youngPersonId = query.youngPersonId;
  if (query.homeId) where.homeId = query.homeId;
  if (query.confidentialityScope) where.confidentialityScope = query.confidentialityScope;
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = query.dateFrom;
    if (query.dateTo) where.createdAt.lte = query.dateTo;
  }

  const [total, rows] = await Promise.all([
    prisma.sensitiveDataRecord.count({ where }),
    prisma.sensitiveDataRecord.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { [query.sortBy]: query.sortOrder },
      include: {
        youngPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
        home: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
  ]);

  return {
    data: rows.map(mapSensitiveDataRecord),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getSensitiveDataRecord(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.sensitiveDataRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    include: {
      youngPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      home: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  if (!row) {
    throw httpError(404, 'SENSITIVE_DATA_NOT_FOUND', 'Sensitive data record not found.');
  }

  await prisma.$transaction([
    prisma.sensitiveDataAccessLog.create({
      data: {
        tenantId: tenant.tenantId,
        recordId: row.id,
        userId: actorUserId,
        action: 'view',
      },
    }),
    prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_accessed,
        entityType: 'sensitive_data',
        entityId: row.id,
      },
    }),
  ]);

  return mapSensitiveDataRecord(row);
}

export async function createSensitiveDataRecord(actorUserId: string, body: CreateSensitiveDataBody) {
  const tenant = await requireTenantContext(actorUserId);

  await Promise.all([
    ensureYoungPersonInTenant(tenant.tenantId, body.youngPersonId),
    ensureHomeInTenant(tenant.tenantId, body.homeId),
    ensureAttachmentFilesInTenant(tenant.tenantId, body.attachmentFileIds),
  ]);

  const created = await prisma.sensitiveDataRecord.create({
    data: {
      tenantId: tenant.tenantId,
      title: body.title,
      category: body.category,
      content: body.content,
      youngPersonId: body.youngPersonId ?? null,
      homeId: body.homeId ?? null,
      confidentialityScope: body.confidentialityScope,
      retentionDate: body.retentionDate ?? null,
      attachmentFileIds: body.attachmentFileIds,
      createdById: actorUserId,
      updatedById: actorUserId,
    },
    include: {
      youngPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      home: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_created,
      entityType: 'sensitive_data',
      entityId: created.id,
    },
  });

  return mapSensitiveDataRecord(created);
}

export async function updateSensitiveDataRecord(actorUserId: string, id: string, body: UpdateSensitiveDataBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.sensitiveDataRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'SENSITIVE_DATA_NOT_FOUND', 'Sensitive data record not found.');
  }

  await Promise.all([
    ensureYoungPersonInTenant(tenant.tenantId, body.youngPersonId),
    ensureHomeInTenant(tenant.tenantId, body.homeId),
    body.attachmentFileIds !== undefined
      ? ensureAttachmentFilesInTenant(tenant.tenantId, body.attachmentFileIds)
      : Promise.resolve(),
  ]);

  const updateData: Prisma.SensitiveDataRecordUpdateInput = {
    updatedBy: { connect: { id: actorUserId } },
  };

  if (body.title !== undefined) updateData.title = body.title;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.content !== undefined) updateData.content = body.content;
  if (body.youngPersonId !== undefined) {
    updateData.youngPerson = body.youngPersonId === null ? { disconnect: true } : { connect: { id: body.youngPersonId } };
  }
  if (body.homeId !== undefined) {
    updateData.home = body.homeId === null ? { disconnect: true } : { connect: { id: body.homeId } };
  }
  if (body.confidentialityScope !== undefined) updateData.confidentialityScope = body.confidentialityScope;
  if (body.retentionDate !== undefined) updateData.retentionDate = body.retentionDate;
  if (body.attachmentFileIds !== undefined) updateData.attachmentFileIds = body.attachmentFileIds;

  const updated = await prisma.sensitiveDataRecord.update({
    where: { id },
    data: updateData,
    include: {
      youngPerson: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      home: { select: { id: true, name: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      updatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'sensitive_data',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapSensitiveDataRecord(updated);
}

export async function deleteSensitiveDataRecord(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.sensitiveDataRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'SENSITIVE_DATA_NOT_FOUND', 'Sensitive data record not found.');
  }

  await prisma.sensitiveDataRecord.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedById: actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'sensitive_data',
      entityId: id,
    },
  });

  return { message: 'Sensitive data record deleted.' };
}

export async function listSensitiveDataCategories(actorUserId: string) {
  const tenant = await requireTenantContext(actorUserId);

  const grouped = await prisma.sensitiveDataRecord.groupBy({
    by: ['category'],
    where: { tenantId: tenant.tenantId, deletedAt: null },
    _count: { _all: true },
    orderBy: { category: 'asc' },
  });

  return grouped.map((row) => ({
    category: row.category,
    count: row._count._all,
  }));
}

export async function getSensitiveDataAccessLog(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const exists = await prisma.sensitiveDataRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!exists) {
    throw httpError(404, 'SENSITIVE_DATA_NOT_FOUND', 'Sensitive data record not found.');
  }

  const rows = await prisma.sensitiveDataAccessLog.findMany({
    where: { tenantId: tenant.tenantId, recordId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    user: {
      id: row.user.id,
      name: displayName(row.user.firstName, row.user.lastName),
      email: row.user.email,
    },
  }));
}
