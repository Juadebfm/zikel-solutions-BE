import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateYoungPersonBody,
  ListYoungPeopleQuery,
  UpdateYoungPersonBody,
} from './young-people.schema.js';

const YP_INCLUDE = {
  home: { select: { id: true, name: true } },
  keyWorker: {
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  practiceManager: { select: { id: true, firstName: true, lastName: true } },
  admin: { select: { id: true, firstName: true, lastName: true } },
} as const;

function toIsoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function userName(user: { firstName: string; lastName: string } | null | undefined): string | null {
  if (!user) return null;
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null;
}

function mapYoungPerson(yp: Prisma.YoungPersonGetPayload<{ include: typeof YP_INCLUDE }>) {
  return {
    id: yp.id,
    homeId: yp.homeId,
    homeName: yp.home.name,
    firstName: yp.firstName,
    lastName: yp.lastName,
    preferredName: yp.preferredName,
    namePronunciation: yp.namePronunciation,
    description: yp.description,
    dateOfBirth: toIsoDate(yp.dateOfBirth),
    gender: yp.gender,
    ethnicity: yp.ethnicity,
    religion: yp.religion,
    referenceNo: yp.referenceNo,
    niNumber: yp.niNumber,
    roomNumber: yp.roomNumber,
    status: yp.status,
    type: yp.type,
    admissionDate: yp.admissionDate,
    placementEndDate: yp.placementEndDate,
    avatarFileId: yp.avatarFileId,
    avatarUrl: yp.avatarUrl,
    keyWorker: yp.keyWorker ? { id: yp.keyWorker.id, name: userName(yp.keyWorker.user) } : null,
    practiceManager: yp.practiceManager ? { id: yp.practiceManager.id, name: userName(yp.practiceManager) } : null,
    admin: yp.admin ? { id: yp.admin.id, name: userName(yp.admin) } : null,
    socialWorkerName: yp.socialWorkerName,
    independentReviewingOfficer: yp.independentReviewingOfficer,
    placingAuthority: yp.placingAuthority,
    legalStatus: yp.legalStatus,
    isEmergencyPlacement: yp.isEmergencyPlacement,
    isAsylumSeeker: yp.isAsylumSeeker,
    contact: yp.contact,
    health: yp.health,
    education: yp.education,
    isActive: yp.isActive,
    createdAt: yp.createdAt,
    updatedAt: yp.updatedAt,
  };
}

async function ensureHomeExists(homeId: string, tenantId: string) {
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listYoungPeople(actorId: string, query: ListYoungPeopleQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.YoungPersonWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    ...(query.gender ? { gender: query.gender } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { preferredName: { contains: query.search, mode: 'insensitive' } },
            { referenceNo: { contains: query.search, mode: 'insensitive' } },
            { home: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.youngPerson.count({ where }),
    prisma.youngPerson.findMany({
      where,
      include: YP_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      skip,
      take: query.pageSize,
    }),
  ]);

  logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'young_person',
    source: 'young-people.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      homeId: query.homeId ?? null,
      status: query.status ?? null,
      hasSearch: Boolean(query.search),
      isActive: query.isActive ?? null,
    },
  });

  return {
    data: rows.map(mapYoungPerson),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getYoungPerson(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const yp = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: YP_INCLUDE,
  });
  if (!yp) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'young_person',
    entityId: id,
    source: 'young-people.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapYoungPerson(yp);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createYoungPerson(actorId: string, body: CreateYoungPersonBody) {
  const tenant = await requireTenantContext(actorId);
  await ensureHomeExists(body.homeId, tenant.tenantId);

  try {
    const yp = await prisma.youngPerson.create({
      data: {
        tenantId: tenant.tenantId,
        homeId: body.homeId,
        firstName: body.firstName,
        lastName: body.lastName,
        preferredName: body.preferredName ?? null,
        namePronunciation: body.namePronunciation ?? null,
        description: body.description ?? null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        gender: body.gender ?? null,
        ethnicity: body.ethnicity ?? null,
        religion: body.religion ?? null,
        referenceNo: body.referenceNo ?? null,
        niNumber: body.niNumber ?? null,
        roomNumber: body.roomNumber ?? null,
        status: body.status ?? 'current',
        type: body.type ?? null,
        admissionDate: body.admissionDate ?? null,
        placementEndDate: body.placementEndDate ?? null,
        avatarUrl: body.avatarUrl ?? null,
        ...(body.avatarFileId ? { avatarFileId: body.avatarFileId } : {}),
        ...(body.keyWorkerId ? { keyWorkerId: body.keyWorkerId } : {}),
        ...(body.practiceManagerId ? { practiceManagerId: body.practiceManagerId } : {}),
        ...(body.adminUserId ? { adminUserId: body.adminUserId } : {}),
        socialWorkerName: body.socialWorkerName ?? null,
        independentReviewingOfficer: body.independentReviewingOfficer ?? null,
        placingAuthority: body.placingAuthority ?? null,
        legalStatus: body.legalStatus ?? null,
        isEmergencyPlacement: body.isEmergencyPlacement ?? false,
        isAsylumSeeker: body.isAsylumSeeker ?? false,
        contact: (body.contact ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        health: (body.health ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        education: (body.education ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
      },
      include: YP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'young_person',
        entityId: yp.id,
      },
    });

    return mapYoungPerson(yp);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'REFERENCE_NO_TAKEN', 'Reference number already exists.');
    }
    throw error;
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateYoungPerson(actorId: string, id: string, body: UpdateYoungPersonBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  if (body.homeId !== undefined) {
    await ensureHomeExists(body.homeId, tenant.tenantId);
  }

  const updateData: Prisma.YoungPersonUpdateInput = {};

  if (body.homeId !== undefined) updateData.home = { connect: { id: body.homeId } };
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.preferredName !== undefined) updateData.preferredName = body.preferredName;
  if (body.namePronunciation !== undefined) updateData.namePronunciation = body.namePronunciation;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.dateOfBirth !== undefined) {
    updateData.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
  }
  if (body.gender !== undefined) updateData.gender = body.gender;
  if (body.ethnicity !== undefined) updateData.ethnicity = body.ethnicity;
  if (body.religion !== undefined) updateData.religion = body.religion;
  if (body.referenceNo !== undefined) updateData.referenceNo = body.referenceNo;
  if (body.niNumber !== undefined) updateData.niNumber = body.niNumber;
  if (body.roomNumber !== undefined) updateData.roomNumber = body.roomNumber;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.admissionDate !== undefined) updateData.admissionDate = body.admissionDate;
  if (body.placementEndDate !== undefined) updateData.placementEndDate = body.placementEndDate;
  if (body.avatarFileId !== undefined) {
    updateData.avatarFile = body.avatarFileId === null ? { disconnect: true } : { connect: { id: body.avatarFileId } };
  }
  if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
  if (body.keyWorkerId !== undefined) {
    updateData.keyWorker = body.keyWorkerId === null ? { disconnect: true } : { connect: { id: body.keyWorkerId } };
  }
  if (body.practiceManagerId !== undefined) {
    updateData.practiceManager = body.practiceManagerId === null ? { disconnect: true } : { connect: { id: body.practiceManagerId } };
  }
  if (body.adminUserId !== undefined) {
    updateData.admin = body.adminUserId === null ? { disconnect: true } : { connect: { id: body.adminUserId } };
  }
  if (body.socialWorkerName !== undefined) updateData.socialWorkerName = body.socialWorkerName;
  if (body.independentReviewingOfficer !== undefined) updateData.independentReviewingOfficer = body.independentReviewingOfficer;
  if (body.placingAuthority !== undefined) updateData.placingAuthority = body.placingAuthority;
  if (body.legalStatus !== undefined) updateData.legalStatus = body.legalStatus;
  if (body.isEmergencyPlacement !== undefined) updateData.isEmergencyPlacement = body.isEmergencyPlacement;
  if (body.isAsylumSeeker !== undefined) updateData.isAsylumSeeker = body.isAsylumSeeker;
  if (body.contact !== undefined) updateData.contact = (body.contact ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  if (body.health !== undefined) updateData.health = (body.health ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  if (body.education !== undefined) updateData.education = (body.education ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const yp = await prisma.youngPerson.update({
      where: { id },
      data: updateData,
      include: YP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_updated,
        entityType: 'young_person',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapYoungPerson(yp);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'REFERENCE_NO_TAKEN', 'Reference number already exists.');
    }
    throw error;
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export async function deactivateYoungPerson(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  await prisma.youngPerson.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'young_person',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Young person deactivated.' };
}
