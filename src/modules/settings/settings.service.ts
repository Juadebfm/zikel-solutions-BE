import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  UpdateOrganisationSettingsBody,
  UpdateSettingsNotificationsBody,
} from './settings.schema.js';

async function getOrCreateTenantSettings(tenantId: string) {
  return prisma.tenantSettings.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
}

function mapOrganisationSettings(tenant: { name: string }, settings: Prisma.TenantSettingsGetPayload<object>) {
  return {
    name: tenant.name,
    timezone: settings.timezone,
    locale: settings.locale,
    dateFormat: settings.dateFormat,
    logoUrl: settings.logoUrl,
    notificationDefaults: settings.notificationDefaults,
    passwordPolicy: settings.passwordPolicy,
    sessionTimeout: settings.sessionTimeout,
    mfaRequired: settings.mfaRequired,
    ipRestriction: settings.ipRestriction,
    dataRetentionDays: settings.dataRetentionDays,
  };
}

function mapNotificationSettings(settings: Prisma.TenantSettingsGetPayload<object>) {
  return {
    emailNotifications: settings.emailNotifications,
    pushNotifications: settings.pushNotifications,
    digestFrequency: settings.digestFrequency,
  };
}

export async function getOrganisationSettings(actorUserId: string) {
  const tenantContext = await requireTenantContext(actorUserId);

  const [tenant, settings] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantContext.tenantId },
      select: { name: true },
    }),
    getOrCreateTenantSettings(tenantContext.tenantId),
  ]);

  return mapOrganisationSettings(tenant, settings);
}

export async function updateOrganisationSettings(actorUserId: string, body: UpdateOrganisationSettingsBody) {
  const tenantContext = await requireTenantContext(actorUserId);

  const [tenant, settings] = await prisma.$transaction(async (tx) => {
    const settingsUpdateData: Prisma.TenantSettingsUpdateInput = {};
    if (body.timezone !== undefined) settingsUpdateData.timezone = body.timezone;
    if (body.locale !== undefined) settingsUpdateData.locale = body.locale;
    if (body.dateFormat !== undefined) settingsUpdateData.dateFormat = body.dateFormat;
    if (body.logoUrl !== undefined) settingsUpdateData.logoUrl = body.logoUrl;
    if (body.notificationDefaults !== undefined) {
      settingsUpdateData.notificationDefaults = (body.notificationDefaults ?? null) as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput;
    }
    if (body.passwordPolicy !== undefined) {
      settingsUpdateData.passwordPolicy = (body.passwordPolicy ?? null) as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput;
    }
    if (body.sessionTimeout !== undefined) settingsUpdateData.sessionTimeout = body.sessionTimeout;
    if (body.mfaRequired !== undefined) settingsUpdateData.mfaRequired = body.mfaRequired;
    if (body.ipRestriction !== undefined) {
      settingsUpdateData.ipRestriction = (body.ipRestriction ?? null) as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput;
    }
    if (body.dataRetentionDays !== undefined) settingsUpdateData.dataRetentionDays = body.dataRetentionDays;

    const tenantUpdate = body.name
      ? tx.tenant.update({
          where: { id: tenantContext.tenantId },
          data: { name: body.name },
          select: { name: true },
        })
      : tx.tenant.findUniqueOrThrow({
          where: { id: tenantContext.tenantId },
          select: { name: true },
        });

    const settingsUpdate = tx.tenantSettings.upsert({
      where: { tenantId: tenantContext.tenantId },
      update: settingsUpdateData,
      create: {
        tenantId: tenantContext.tenantId,
        timezone: body.timezone ?? 'Europe/London',
        locale: body.locale ?? 'en-GB',
        dateFormat: body.dateFormat ?? 'DD/MM/YYYY',
        logoUrl: body.logoUrl ?? null,
        notificationDefaults: (body.notificationDefaults ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        passwordPolicy: (body.passwordPolicy ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        sessionTimeout: body.sessionTimeout ?? null,
        mfaRequired: body.mfaRequired ?? false,
        ipRestriction: (body.ipRestriction ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        dataRetentionDays: body.dataRetentionDays ?? null,
      },
    });

    return Promise.all([tenantUpdate, settingsUpdate]);
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenantContext.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'tenant_settings',
      entityId: tenantContext.tenantId,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapOrganisationSettings(tenant, settings);
}

export async function getSettingsNotifications(actorUserId: string) {
  const tenantContext = await requireTenantContext(actorUserId);
  const settings = await getOrCreateTenantSettings(tenantContext.tenantId);
  return mapNotificationSettings(settings);
}

export async function updateSettingsNotifications(actorUserId: string, body: UpdateSettingsNotificationsBody) {
  const tenantContext = await requireTenantContext(actorUserId);

  const updateData: Prisma.TenantSettingsUpdateInput = {};
  if (body.emailNotifications !== undefined) updateData.emailNotifications = body.emailNotifications;
  if (body.pushNotifications !== undefined) updateData.pushNotifications = body.pushNotifications;
  if (body.digestFrequency !== undefined) updateData.digestFrequency = body.digestFrequency;

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId: tenantContext.tenantId },
    update: updateData,
    create: {
      tenantId: tenantContext.tenantId,
      emailNotifications: body.emailNotifications ?? true,
      pushNotifications: body.pushNotifications ?? true,
      digestFrequency: body.digestFrequency ?? 'daily',
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenantContext.tenantId,
      userId: actorUserId,
      action: AuditAction.record_updated,
      entityType: 'tenant_settings_notifications',
      entityId: tenantContext.tenantId,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapNotificationSettings(settings);
}
