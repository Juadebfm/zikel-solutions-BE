import { AuditAction, Prisma, type Vehicle } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
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
    registration: vehicle.registration,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    colour: vehicle.colour,
    isActive: vehicle.isActive,
    nextServiceDue: vehicle.nextServiceDue,
    motDue: vehicle.motDue,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
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
  return mapVehicle(vehicle);
}

export async function createVehicle(actorUserId: string, body: CreateVehicleBody) {
  const tenant = await requireTenantContext(actorUserId);
  try {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId: tenant.tenantId,
        registration: normalizeRegistration(body.registration),
        make: body.make ?? null,
        model: body.model ?? null,
        year: body.year ?? null,
        colour: body.colour ?? null,
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

  const updateData: Prisma.VehicleUpdateInput = {};
  if (body.registration !== undefined) {
    updateData.registration = normalizeRegistration(body.registration);
  }
  if (body.make !== undefined) updateData.make = body.make;
  if (body.model !== undefined) updateData.model = body.model;
  if (body.year !== undefined) updateData.year = body.year;
  if (body.colour !== undefined) updateData.colour = body.colour;
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
