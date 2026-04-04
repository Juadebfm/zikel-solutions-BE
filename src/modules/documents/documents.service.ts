import { AuditAction, Prisma, UploadStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
import type { CreateDocumentBody, ListDocumentsQuery, UpdateDocumentBody } from './documents.schema.js';

function toDisplayName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim();
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function mapDocumentRow(
  row: Prisma.DocumentRecordGetPayload<{
    include: {
      file: { select: { id: true; originalName: true; contentType: true; sizeBytes: true; status: true } };
      home: { select: { id: true; name: true } };
      uploadedBy: { select: { id: true; firstName: true; lastName: true; email: true } };
    };
  }>,
) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    visibility: row.visibility,
    tags: row.tags,
    home: row.home ? { id: row.home.id, name: row.home.name } : null,
    file: {
      id: row.file.id,
      originalName: row.file.originalName,
      contentType: row.file.contentType,
      sizeBytes: row.file.sizeBytes,
      status: row.file.status,
    },
    uploadedBy: row.uploadedBy
      ? {
          id: row.uploadedBy.id,
          name: toDisplayName(row.uploadedBy.firstName, row.uploadedBy.lastName),
          email: row.uploadedBy.email,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ensureHomeInTenant(tenantId: string, homeId: string | null | undefined) {
  if (!homeId) return;
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

async function ensureFileUsableInTenant(tenantId: string, fileId: string) {
  await assertUploadedFilesBelongToTenant(tenantId, [fileId]);
  const file = await prisma.uploadedFile.findFirst({
    where: { id: fileId, tenantId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!file) {
    throw httpError(404, 'FILE_NOT_FOUND', 'Uploaded file not found.');
  }
  if (file.status !== UploadStatus.uploaded) {
    throw httpError(409, 'FILE_NOT_READY', 'Uploaded file is not finalized yet.');
  }
}

export async function listDocuments(actorUserId: string, query: ListDocumentsQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.DocumentRecordWhereInput = {
    tenantId: tenant.tenantId,
    deletedAt: null,
  };

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { category: { contains: query.search, mode: 'insensitive' } },
      { tags: { has: query.search } },
    ];
  }

  if (query.category) where.category = query.category;
  if (query.homeId) where.homeId = query.homeId;
  if (query.uploadedBy) where.uploadedById = query.uploadedBy;

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) where.createdAt.gte = query.dateFrom;
    if (query.dateTo) where.createdAt.lte = query.dateTo;
  }

  const [total, rows] = await Promise.all([
    prisma.documentRecord.count({ where }),
    prisma.documentRecord.findMany({
      where,
      skip,
      take: query.pageSize,
      include: {
        file: {
          select: {
            id: true,
            originalName: true,
            contentType: true,
            sizeBytes: true,
            status: true,
          },
        },
        home: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { [query.sortBy]: query.sortOrder },
    }),
  ]);

  return {
    data: rows.map(mapDocumentRow),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getDocument(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.documentRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    include: {
      file: {
        select: {
          id: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          status: true,
        },
      },
      home: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  if (!row) {
    throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  return mapDocumentRow(row);
}

export async function createDocument(actorUserId: string, body: CreateDocumentBody) {
  const tenant = await requireTenantContext(actorUserId);

  await Promise.all([
    ensureHomeInTenant(tenant.tenantId, body.homeId),
    ensureFileUsableInTenant(tenant.tenantId, body.fileId),
  ]);

  const created = await prisma.documentRecord.create({
    data: {
      tenantId: tenant.tenantId,
      fileId: body.fileId,
      homeId: body.homeId ?? null,
      uploadedById: actorUserId,
      title: body.title,
      description: body.description ?? null,
      category: body.category,
      visibility: body.visibility,
      tags: body.tags,
    },
    include: {
      file: {
        select: {
          id: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          status: true,
        },
      },
      home: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_created,
      entityType: 'document',
      entityId: created.id,
      metadata: {
        category: created.category,
        visibility: created.visibility,
      },
    },
  });

  return mapDocumentRow(created);
}

export async function updateDocument(actorUserId: string, id: string, body: UpdateDocumentBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.documentRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  if (body.homeId !== undefined) {
    await ensureHomeInTenant(tenant.tenantId, body.homeId);
  }
  if (body.fileId !== undefined) {
    await ensureFileUsableInTenant(tenant.tenantId, body.fileId);
  }

  const updateData: Prisma.DocumentRecordUpdateInput = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.visibility !== undefined) updateData.visibility = body.visibility;
  if (body.tags !== undefined) updateData.tags = body.tags;
  if (body.fileId !== undefined) {
    updateData.file = { connect: { id: body.fileId } };
  }
  if (body.homeId !== undefined) {
    updateData.home = body.homeId === null ? { disconnect: true } : { connect: { id: body.homeId } };
  }

  const updated = await prisma.documentRecord.update({
    where: { id },
    data: updateData,
    include: {
      file: {
        select: {
          id: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          status: true,
        },
      },
      home: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'document',
      entityId: updated.id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapDocumentRow(updated);
}

export async function deleteDocument(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.documentRecord.findFirst({
    where: { id, tenantId: tenant.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  await prisma.documentRecord.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'document',
      entityId: id,
    },
  });

  return { message: 'Document deleted.' };
}

export async function listDocumentCategories(actorUserId: string) {
  const tenant = await requireTenantContext(actorUserId);

  const grouped = await prisma.documentRecord.groupBy({
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
