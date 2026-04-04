-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('private', 'tenant', 'home');

-- CreateEnum
CREATE TYPE "ExportJobEntity" AS ENUM ('homes', 'employees', 'young_people', 'vehicles', 'care_groups', 'tasks', 'daily_logs', 'audit');

-- CreateEnum
CREATE TYPE "ExportJobFormat" AS ENUM ('pdf', 'excel', 'csv');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "GroupingType" AS ENUM ('operational', 'reporting', 'custom');

-- CreateEnum
CREATE TYPE "GroupingEntityType" AS ENUM ('home', 'employee', 'care_group');

-- CreateEnum
CREATE TYPE "SensitiveDataConfidentialityScope" AS ENUM ('restricted', 'confidential', 'highly_confidential');

-- AlterTable
ALTER TABLE "HomeEvent"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "attendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recurrence" JSONB,
  ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DocumentRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "homeId" TEXT,
  "uploadedById" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "visibility" "DocumentVisibility" NOT NULL DEFAULT 'tenant',
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "entity" "ExportJobEntity" NOT NULL,
  "filters" JSONB,
  "format" "ExportJobFormat" NOT NULL,
  "status" "ExportJobStatus" NOT NULL DEFAULT 'pending',
  "errorMessage" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
  "locale" TEXT NOT NULL DEFAULT 'en-GB',
  "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  "logoUrl" TEXT,
  "notificationDefaults" JSONB,
  "passwordPolicy" JSONB,
  "sessionTimeout" INTEGER,
  "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
  "ipRestriction" JSONB,
  "dataRetentionDays" INTEGER,
  "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
  "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
  "digestFrequency" TEXT NOT NULL DEFAULT 'daily',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rota" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "weekStarting" TIMESTAMP(3) NOT NULL,
  "shifts" JSONB NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Rota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotaTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "homeId" TEXT,
  "name" TEXT NOT NULL,
  "shifts" JSONB NOT NULL,
  "createdById" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RotaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionHome" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RegionHome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grouping" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" "GroupingType" NOT NULL DEFAULT 'custom',
  "entityType" "GroupingEntityType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Grouping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupingMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "groupingId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GroupingMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveDataRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "youngPersonId" TEXT,
  "homeId" TEXT,
  "confidentialityScope" "SensitiveDataConfidentialityScope" NOT NULL DEFAULT 'confidential',
  "retentionDate" TIMESTAMP(3),
  "attachmentFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SensitiveDataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitiveDataAccessLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'view',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SensitiveDataAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentRecord_tenantId_category_idx" ON "DocumentRecord"("tenantId", "category");
CREATE INDEX "DocumentRecord_tenantId_createdAt_idx" ON "DocumentRecord"("tenantId", "createdAt");
CREATE INDEX "DocumentRecord_fileId_idx" ON "DocumentRecord"("fileId");
CREATE INDEX "DocumentRecord_homeId_idx" ON "DocumentRecord"("homeId");
CREATE INDEX "DocumentRecord_uploadedById_idx" ON "DocumentRecord"("uploadedById");
CREATE INDEX "DocumentRecord_deletedAt_idx" ON "DocumentRecord"("deletedAt");

CREATE INDEX "ExportJob_tenantId_status_createdAt_idx" ON "ExportJob"("tenantId", "status", "createdAt");
CREATE INDEX "ExportJob_tenantId_entity_createdAt_idx" ON "ExportJob"("tenantId", "entity", "createdAt");
CREATE INDEX "ExportJob_createdById_createdAt_idx" ON "ExportJob"("createdById", "createdAt");

CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");
CREATE INDEX "TenantSettings_tenantId_idx" ON "TenantSettings"("tenantId");

CREATE UNIQUE INDEX "Rota_tenantId_homeId_weekStarting_key" ON "Rota"("tenantId", "homeId", "weekStarting");
CREATE INDEX "Rota_tenantId_weekStarting_idx" ON "Rota"("tenantId", "weekStarting");
CREATE INDEX "Rota_homeId_weekStarting_idx" ON "Rota"("homeId", "weekStarting");
CREATE INDEX "Rota_createdById_idx" ON "Rota"("createdById");
CREATE INDEX "Rota_updatedById_idx" ON "Rota"("updatedById");

CREATE INDEX "RotaTemplate_tenantId_homeId_createdAt_idx" ON "RotaTemplate"("tenantId", "homeId", "createdAt");
CREATE INDEX "RotaTemplate_createdById_idx" ON "RotaTemplate"("createdById");

CREATE UNIQUE INDEX "Region_tenantId_name_key" ON "Region"("tenantId", "name");
CREATE INDEX "Region_tenantId_isActive_createdAt_idx" ON "Region"("tenantId", "isActive", "createdAt");
CREATE INDEX "HomeEvent_tenantId_type_startsAt_idx" ON "HomeEvent"("tenantId", "type", "startsAt");

CREATE UNIQUE INDEX "RegionHome_regionId_homeId_key" ON "RegionHome"("regionId", "homeId");
CREATE INDEX "RegionHome_tenantId_homeId_idx" ON "RegionHome"("tenantId", "homeId");
CREATE INDEX "RegionHome_tenantId_regionId_idx" ON "RegionHome"("tenantId", "regionId");

CREATE UNIQUE INDEX "Grouping_tenantId_name_entityType_key" ON "Grouping"("tenantId", "name", "entityType");
CREATE INDEX "Grouping_tenantId_type_isActive_createdAt_idx" ON "Grouping"("tenantId", "type", "isActive", "createdAt");
CREATE INDEX "Grouping_createdById_idx" ON "Grouping"("createdById");

CREATE UNIQUE INDEX "GroupingMember_groupingId_entityId_key" ON "GroupingMember"("groupingId", "entityId");
CREATE INDEX "GroupingMember_tenantId_entityId_idx" ON "GroupingMember"("tenantId", "entityId");

CREATE INDEX "SensitiveDataRecord_tenantId_category_createdAt_idx" ON "SensitiveDataRecord"("tenantId", "category", "createdAt");
CREATE INDEX "SensitiveDataRecord_tenantId_confidentialityScope_createdAt_idx" ON "SensitiveDataRecord"("tenantId", "confidentialityScope", "createdAt");
CREATE INDEX "SensitiveDataRecord_youngPersonId_idx" ON "SensitiveDataRecord"("youngPersonId");
CREATE INDEX "SensitiveDataRecord_homeId_idx" ON "SensitiveDataRecord"("homeId");
CREATE INDEX "SensitiveDataRecord_createdById_idx" ON "SensitiveDataRecord"("createdById");
CREATE INDEX "SensitiveDataRecord_deletedAt_idx" ON "SensitiveDataRecord"("deletedAt");

CREATE INDEX "SensitiveDataAccessLog_tenantId_recordId_createdAt_idx" ON "SensitiveDataAccessLog"("tenantId", "recordId", "createdAt");
CREATE INDEX "SensitiveDataAccessLog_userId_createdAt_idx" ON "SensitiveDataAccessLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentRecord" ADD CONSTRAINT "DocumentRecord_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Rota" ADD CONSTRAINT "Rota_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rota" ADD CONSTRAINT "Rota_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rota" ADD CONSTRAINT "Rota_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rota" ADD CONSTRAINT "Rota_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RotaTemplate" ADD CONSTRAINT "RotaTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RotaTemplate" ADD CONSTRAINT "RotaTemplate_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RotaTemplate" ADD CONSTRAINT "RotaTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Region" ADD CONSTRAINT "Region_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegionHome" ADD CONSTRAINT "RegionHome_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegionHome" ADD CONSTRAINT "RegionHome_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegionHome" ADD CONSTRAINT "RegionHome_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Grouping" ADD CONSTRAINT "Grouping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Grouping" ADD CONSTRAINT "Grouping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GroupingMember" ADD CONSTRAINT "GroupingMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupingMember" ADD CONSTRAINT "GroupingMember_groupingId_fkey" FOREIGN KEY ("groupingId") REFERENCES "Grouping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SensitiveDataRecord" ADD CONSTRAINT "SensitiveDataRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataRecord" ADD CONSTRAINT "SensitiveDataRecord_youngPersonId_fkey" FOREIGN KEY ("youngPersonId") REFERENCES "YoungPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataRecord" ADD CONSTRAINT "SensitiveDataRecord_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataRecord" ADD CONSTRAINT "SensitiveDataRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataRecord" ADD CONSTRAINT "SensitiveDataRecord_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SensitiveDataAccessLog" ADD CONSTRAINT "SensitiveDataAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataAccessLog" ADD CONSTRAINT "SensitiveDataAccessLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "SensitiveDataRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SensitiveDataAccessLog" ADD CONSTRAINT "SensitiveDataAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
