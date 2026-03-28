-- Task domain canonicalization + asset references

-- Enums
CREATE TYPE "TaskCategory" AS ENUM (
  'task_log',
  'document',
  'system_link',
  'checklist',
  'incident',
  'other'
);

CREATE TYPE "TaskReferenceType" AS ENUM (
  'entity',
  'upload',
  'internal_route',
  'external_url',
  'document_url'
);

CREATE TYPE "TaskReferenceEntityType" AS ENUM (
  'tenant',
  'care_group',
  'home',
  'young_person',
  'vehicle',
  'employee',
  'task'
);

-- Home enrichments
ALTER TABLE "Home"
  ADD COLUMN "avatarFileId" TEXT,
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "details" JSONB;

-- Vehicle enrichments
ALTER TABLE "Vehicle"
  ADD COLUMN "homeId" TEXT,
  ADD COLUMN "avatarFileId" TEXT,
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "details" JSONB;

-- Task enrichments
ALTER TABLE "Task"
  ADD COLUMN "category" "TaskCategory" NOT NULL DEFAULT 'task_log',
  ADD COLUMN "signatureFileId" TEXT,
  ADD COLUMN "homeId" TEXT,
  ADD COLUMN "vehicleId" TEXT;

-- Backfill likely-document tasks
UPDATE "Task"
SET "category" = 'document'
WHERE LOWER(COALESCE("formName", '')) ~ '(policy|statement|procedure|guidance|manual|document)'
   OR LOWER(COALESCE("title", '')) ~ '(policy|statement|procedure|guidance|manual|document)';

-- Task reference table
CREATE TABLE "TaskReference" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "type" "TaskReferenceType" NOT NULL,
  "entityType" "TaskReferenceEntityType",
  "entityId" TEXT,
  "fileId" TEXT,
  "url" TEXT,
  "label" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskReference_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Home_avatarFileId_idx" ON "Home"("avatarFileId");
CREATE INDEX "Vehicle_homeId_idx" ON "Vehicle"("homeId");
CREATE INDEX "Vehicle_avatarFileId_idx" ON "Vehicle"("avatarFileId");
CREATE INDEX "Task_category_idx" ON "Task"("category");
CREATE INDEX "Task_homeId_idx" ON "Task"("homeId");
CREATE INDEX "Task_vehicleId_idx" ON "Task"("vehicleId");
CREATE INDEX "Task_signatureFileId_idx" ON "Task"("signatureFileId");
CREATE INDEX "TaskReference_tenantId_taskId_idx" ON "TaskReference"("tenantId", "taskId");
CREATE INDEX "TaskReference_tenantId_type_idx" ON "TaskReference"("tenantId", "type");
CREATE INDEX "TaskReference_entityType_entityId_idx" ON "TaskReference"("entityType", "entityId");
CREATE INDEX "TaskReference_fileId_idx" ON "TaskReference"("fileId");

-- Foreign keys
ALTER TABLE "Home"
  ADD CONSTRAINT "Home_avatarFileId_fkey"
  FOREIGN KEY ("avatarFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_avatarFileId_fkey"
  FOREIGN KEY ("avatarFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_signatureFileId_fkey"
  FOREIGN KEY ("signatureFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskReference"
  ADD CONSTRAINT "TaskReference_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskReference"
  ADD CONSTRAINT "TaskReference_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskReference"
  ADD CONSTRAINT "TaskReference_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
