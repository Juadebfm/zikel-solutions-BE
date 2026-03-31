import { AuditAction, Prisma, type Vehicle } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
import type {
  CreateVehicleBody,
  ListVehiclesQuery,
  UpdateVehicleBody,
} from './vehicles.schema.js';

const SORTABLE_FIELDS = new Set([
  'registration',
  'make',
  'model',
  'nextServiceDue',
  'motDue',
  'createdAt',
  'updatedAt',
]);

function normalizeRegistration(registration: string) {
  return registration.trim().replace(/\s+/g, ' ').toUpperCase();
}

function mapVehicle(vehicle: Vehicle) {
  return {
    id: vehicle.id,
    homeId: vehicle.homeId,
    registration: vehicle.registration,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    colour: vehicle.colour,
    description: vehicle.description,
    status: vehicle.status,
    vin: vehicle.vin,
    registrationDate: vehicle.registrationDate,
    taxDate: vehicle.taxDate,
    fuelType: vehicle.fuelType,
    insuranceDate: vehicle.insuranceDate,
    ownership: vehicle.ownership,
    leaseStartDate: vehicle.leaseStartDate,
    leaseEndDate: vehicle.leaseEndDate,
    purchasePrice: vehicle.purchasePrice,
    purchaseDate: vehicle.purchaseDate,
    startDate: vehicle.startDate,
    endDate: vehicle.endDate,
    adminUserId: vehicle.adminUserId,
    contactPhone: vehicle.contactPhone,
    avatarFileId: vehicle.avatarFileId,
    avatarUrl: vehicle.avatarUrl,
    details: vehicle.details,
    isActive: vehicle.isActive,
    nextServiceDue: vehicle.nextServiceDue,
    motDue: vehicle.motDue,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}

async function ensureHomeExists(tenantId: string, homeId: string) {
  const exists = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!exists) {
    throw httpError(422, 'HOME_NOT_FOUND', 'Home does not exist in active tenant.');
  }
}

function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function orderByFromQuery(
  query: ListVehiclesQuery,
): Prisma.VehicleOrderByWithRelationInput[] {
  if (query.sortBy && SORTABLE_FIELDS.has(query.sortBy)) {
    return [{ [query.sortBy]: query.sortOrder }] as Prisma.VehicleOrderByWithRelationInput[];
  }
  return [{ registration: 'asc' }];
}

export async function listVehicles(actorUserId: string, query: ListVehiclesQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.VehicleWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.search
      ? {
          OR: [
            { registration: { contains: query.search, mode: 'insensitive' } },
            { make: { contains: query.search, mode: 'insensitive' } },
            { model: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    ...(query.fuelType ? { fuelType: query.fuelType } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      orderBy: orderByFromQuery(query),
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId,
    tenantId: tenant.tenantId,
    entityType: 'vehicle',
    source: 'vehicles.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? null,
      sortOrder: query.sortOrder ?? null,
      hasSearch: Boolean(query.search),
      homeId: query.homeId ?? null,
      isActive: query.isActive ?? null,
    },
  });

  return {
    data: rows.map(mapVehicle),
    meta: paginationMeta(total, query.page, query.pageSize),
  };
}

export async function getVehicle(actorUserId: string, vehicleId: string) {
  const tenant = await requireTenantContext(actorUserId);
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId: tenant.tenantId },
  });
  if (!vehicle) {
    throw httpError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.');
  }

  await logSensitiveReadAccess({
    actorUserId,
    tenantId: tenant.tenantId,
    entityType: 'vehicle',
    entityId: vehicleId,
    source: 'vehicles.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapVehicle(vehicle);
}

export async function createVehicle(actorUserId: string, body: CreateVehicleBody) {
  const tenant = await requireTenantContext(actorUserId);
  if (body.homeId) {
    await ensureHomeExists(tenant.tenantId, body.homeId);
  }
  if (body.avatarFileId) {
    await assertUploadedFilesBelongToTenant(tenant.tenantId, [body.avatarFileId]);
  }
  try {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId: tenant.tenantId,
        homeId: body.homeId ?? null,
        registration: normalizeRegistration(body.registration),
        make: body.make ?? null,
        model: body.model ?? null,
        year: body.year ?? null,
        colour: body.colour ?? null,
        description: body.description ?? null,
        status: body.status ?? 'current',
        vin: body.vin ?? null,
        registrationDate: body.registrationDate ?? null,
        taxDate: body.taxDate ?? null,
        fuelType: body.fuelType ?? null,
        insuranceDate: body.insuranceDate ?? null,
        ownership: body.ownership ?? null,
        leaseStartDate: body.leaseStartDate ?? null,
        leaseEndDate: body.leaseEndDate ?? null,
        purchasePrice: body.purchasePrice ?? null,
        purchaseDate: body.purchaseDate ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        adminUserId: body.adminUserId ?? null,
        contactPhone: body.contactPhone ?? null,
        ...(body.avatarFileId ? { avatarFileId: body.avatarFileId } : {}),
        avatarUrl: body.avatarUrl ?? null,
        details: (body.details ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        isActive: body.isActive ?? true,
        nextServiceDue: body.nextServiceDue ?? null,
        motDue: body.motDue ?? null,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_created,
        entityType: 'vehicle',
        entityId: vehicle.id,
      },
    });

    return mapVehicle(vehicle);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(
        409,
        'VEHICLE_REGISTRATION_TAKEN',
        'A vehicle with this registration already exists.',
      );
    }
    throw error;
  }
}

export async function updateVehicle(actorUserId: string, vehicleId: string, body: UpdateVehicleBody) {
  const tenant = await requireTenantContext(actorUserId);
  const existing = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.');
  }
  if (body.homeId) {
    await ensureHomeExists(tenant.tenantId, body.homeId);
  }
  if (body.avatarFileId) {
    await assertUploadedFilesBelongToTenant(tenant.tenantId, [body.avatarFileId]);
  }

  const updateData: Prisma.VehicleUpdateInput = {};
  if (body.homeId !== undefined) updateData.home = body.homeId === null ? { disconnect: true } : { connect: { id: body.homeId } };
  if (body.registration !== undefined) {
    updateData.registration = normalizeRegistration(body.registration);
  }
  if (body.make !== undefined) updateData.make = body.make;
  if (body.model !== undefined) updateData.model = body.model;
  if (body.year !== undefined) updateData.year = body.year;
  if (body.colour !== undefined) updateData.colour = body.colour;
  if (body.avatarFileId !== undefined) {
    updateData.avatarFile = body.avatarFileId === null
      ? { disconnect: true }
      : { connect: { id: body.avatarFileId } };
  }
  if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.vin !== undefined) updateData.vin = body.vin;
  if (body.registrationDate !== undefined) updateData.registrationDate = body.registrationDate;
  if (body.taxDate !== undefined) updateData.taxDate = body.taxDate;
  if (body.fuelType !== undefined) updateData.fuelType = body.fuelType;
  if (body.insuranceDate !== undefined) updateData.insuranceDate = body.insuranceDate;
  if (body.ownership !== undefined) updateData.ownership = body.ownership;
  if (body.leaseStartDate !== undefined) updateData.leaseStartDate = body.leaseStartDate;
  if (body.leaseEndDate !== undefined) updateData.leaseEndDate = body.leaseEndDate;
  if (body.purchasePrice !== undefined) updateData.purchasePrice = body.purchasePrice;
  if (body.purchaseDate !== undefined) updateData.purchaseDate = body.purchaseDate;
  if (body.startDate !== undefined) updateData.startDate = body.startDate;
  if (body.endDate !== undefined) updateData.endDate = body.endDate;
  if (body.adminUserId !== undefined) updateData.adminUserId = body.adminUserId;
  if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone;
  if (body.details !== undefined) {
    updateData.details = (body.details ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.nextServiceDue !== undefined) updateData.nextServiceDue = body.nextServiceDue;
  if (body.motDue !== undefined) updateData.motDue = body.motDue;

  try {
    const updated = await prisma.vehicle.update({
      where: { id: vehicleId },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_updated,
        entityType: 'vehicle',
        entityId: vehicleId,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapVehicle(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(
        409,
        'VEHICLE_REGISTRATION_TAKEN',
        'A vehicle with this registration already exists.',
      );
    }
    throw error;
  }
}

export async function deactivateVehicle(actorUserId: string, vehicleId: string) {
  const tenant = await requireTenantContext(actorUserId);
  const existing = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.');
  }

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'vehicle',
      entityId: vehicleId,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Vehicle deactivated.' };
}
