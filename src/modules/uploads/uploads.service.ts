import { AuditAction, UploadStatus, type UploadedFile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import {
  assertUploadsEnabled,
  buildStorageKey,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  getFileExtension,
  headUploadedObject,
  maybeBuildPublicFileUrl,
  validateUploadInput,
} from '../../lib/uploads.js';
import type { CompleteUploadBody, CreateUploadSessionBody } from './uploads.schema.js';

function mapUploadedFile(file: UploadedFile) {
  return {
    id: file.id,
    originalName: file.originalName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    purpose: file.purpose,
    status: file.status,
    checksumSha256: file.checksumSha256,
    uploadedAt: file.uploadedAt,
    publicUrl: file.status === UploadStatus.uploaded ? maybeBuildPublicFileUrl(file.storageKey) : null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function getUploadUrlExpiryIso() {
  return new Date(Date.now() + (Number.parseInt(String(process.env.UPLOADS_SIGNED_URL_TTL_SECONDS ?? ''), 10) || 900) * 1000).toISOString();
}

async function getTenantActor(actorUserId: string) {
  const tenant = await requireTenantContext(actorUserId);
  return {
    tenantId: tenant.tenantId,
    tenantRole: tenant.tenantRole,
  };
}

export async function createUploadSession(actorUserId: string, body: CreateUploadSessionBody) {
  assertUploadsEnabled();
  validateUploadInput({
    fileName: body.fileName,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
  });

  const actor = await getTenantActor(actorUserId);
  const storageKey = buildStorageKey({
    tenantId: actor.tenantId,
    purpose: body.purpose,
    fileName: body.fileName,
  });

  const upload = await prisma.uploadedFile.create({
    data: {
      tenantId: actor.tenantId,
      uploadedById: actorUserId,
      storageKey,
      originalName: body.fileName,
      contentType: body.contentType.trim().toLowerCase(),
      sizeBytes: body.sizeBytes,
      purpose: body.purpose,
      status: UploadStatus.pending,
      checksumSha256: body.checksumSha256 ?? null,
      metadata: {
        fileExtension: getFileExtension(body.fileName),
        tenantRoleAtCreation: actor.tenantRole,
        correlationId: randomUUID(),
      },
    },
  });

  const uploadUrl = await createSignedUploadUrl({
    key: storageKey,
    contentType: upload.contentType,
    checksumSha256: upload.checksumSha256,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actorUserId,
      action: AuditAction.record_created,
      entityType: 'uploaded_file',
      entityId: upload.id,
      metadata: {
        status: upload.status,
        purpose: upload.purpose,
        contentType: upload.contentType,
        sizeBytes: upload.sizeBytes,
      },
    },
  });

  return {
    file: mapUploadedFile(upload),
    upload: {
      method: 'PUT' as const,
      url: uploadUrl,
      expiresAt: getUploadUrlExpiryIso(),
      headers: {
        'Content-Type': upload.contentType,
      },
    },
  };
}

export async function completeUploadSession(
  actorUserId: string,
  uploadId: string,
  body: CompleteUploadBody,
) {
  assertUploadsEnabled();
  const actor = await getTenantActor(actorUserId);

  const existing = await prisma.uploadedFile.findFirst({
    where: {
      id: uploadId,
      tenantId: actor.tenantId,
      deletedAt: null,
    },
  });

  if (!existing) {
    throw httpError(404, 'UPLOAD_NOT_FOUND', 'Upload session not found.');
  }

  if (existing.status === UploadStatus.uploaded) {
    return {
      file: mapUploadedFile(existing),
      download: {
        url: await createSignedDownloadUrl(existing.storageKey),
        expiresAt: getUploadUrlExpiryIso(),
      },
    };
  }

  let objectHead: { etag: string | null; contentLength: number | null; contentType: string | null };
  try {
    objectHead = await headUploadedObject(existing.storageKey);
  } catch {
    throw httpError(
      409,
      'UPLOAD_OBJECT_NOT_FOUND',
      'Uploaded object was not found in storage. Complete upload after PUT succeeds.',
    );
  }

  const actualSize = objectHead.contentLength;
  const expectedSize = body.expectedSizeBytes ?? existing.sizeBytes;
  if (actualSize !== null && actualSize !== expectedSize) {
    throw httpError(
      409,
      'UPLOAD_SIZE_MISMATCH',
      `Uploaded object size mismatch. Expected ${expectedSize}, got ${actualSize}.`,
    );
  }

  const finalized = await prisma.uploadedFile.update({
    where: { id: existing.id },
    data: {
      status: UploadStatus.uploaded,
      uploadedAt: new Date(),
      etag: objectHead.etag,
      sizeBytes: actualSize ?? existing.sizeBytes,
      contentType: objectHead.contentType ?? existing.contentType,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'uploaded_file',
      entityId: finalized.id,
      metadata: {
        status: finalized.status,
        sizeBytes: finalized.sizeBytes,
      },
    },
  });

  return {
    file: mapUploadedFile(finalized),
    download: {
      url: await createSignedDownloadUrl(finalized.storageKey),
      expiresAt: getUploadUrlExpiryIso(),
    },
  };
}

export async function getUploadDownloadUrl(actorUserId: string, uploadId: string) {
  assertUploadsEnabled();
  const actor = await getTenantActor(actorUserId);

  const file = await prisma.uploadedFile.findFirst({
    where: {
      id: uploadId,
      tenantId: actor.tenantId,
      deletedAt: null,
      status: UploadStatus.uploaded,
    },
  });

  if (!file) {
    throw httpError(404, 'UPLOAD_NOT_FOUND', 'Uploaded file not found.');
  }

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actorUserId,
      action: AuditAction.record_accessed,
      entityType: 'uploaded_file',
      entityId: file.id,
    },
  });

  return {
    file: mapUploadedFile(file),
    download: {
      url: await createSignedDownloadUrl(file.storageKey),
      expiresAt: getUploadUrlExpiryIso(),
    },
  };
}

export async function assertUploadedFilesBelongToTenant(tenantId: string, fileIds: string[]) {
  const deduped = [...new Set(fileIds.filter(Boolean))];
  if (deduped.length === 0) return;

  const rows = await prisma.uploadedFile.findMany({
    where: {
      id: { in: deduped },
      tenantId,
      deletedAt: null,
      status: UploadStatus.uploaded,
    },
    select: { id: true },
  });

  if (rows.length !== deduped.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = deduped.filter((id) => !found.has(id));
    throw httpError(
      422,
      'INVALID_FILE_REFERENCE',
      `One or more referenced files are invalid or unavailable: ${missing.join(', ')}`,
    );
  }
}
