-- Phase 1.4: enforce tenant ownership on core domain tables

-- 1) Add tenantId columns (nullable first for backfill)
ALTER TABLE "CareGroup" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Home" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "HomeEvent" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "EmployeeShift" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Widget" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- 2) Ensure legacy tenant exists for safe backfill
INSERT INTO "Tenant" ("id", "name", "slug", "country", "isActive", "createdAt", "updatedAt")
SELECT
  'mig_legacy_tenant',
  'Legacy Tenant',
  'legacy-default',
  'UK'::"Country",
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Tenant" WHERE "slug" = 'legacy-default'
);

-- 3) Normalize user active tenant context first
UPDATE "User" u
SET "activeTenantId" = (
  SELECT tm."tenantId"
  FROM "TenantMembership" tm
  WHERE tm."userId" = u."id" AND tm."status" = 'active'::"MembershipStatus"
  ORDER BY tm."createdAt" ASC
  LIMIT 1
)
WHERE u."activeTenantId" IS NULL;

UPDATE "User"
SET "activeTenantId" = (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
WHERE "activeTenantId" IS NULL;

-- 4) Ensure every user has at least one active membership in their active tenant
INSERT INTO "TenantMembership" (
  "id",
  "tenantId",
  "userId",
  "role",
  "status",
  "invitedById",
  "createdAt",
  "updatedAt"
)
SELECT
  'mig_tm_' || substr(md5(u."id" || random()::text || clock_timestamp()::text), 1, 22),
  u."activeTenantId",
  u."id",
  CASE
    WHEN u."role" = 'admin'::"UserRole" THEN 'tenant_admin'::"TenantRole"
    WHEN u."role" = 'manager'::"UserRole" THEN 'sub_admin'::"TenantRole"
    ELSE 'staff'::"TenantRole"
  END,
  'active'::"MembershipStatus",
  NULL,
  NOW(),
  NOW()
FROM "User" u
WHERE u."activeTenantId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TenantMembership" tm
    WHERE tm."tenantId" = u."activeTenantId" AND tm."userId" = u."id"
  );

-- 5) Backfill tenant ownership on domain tables
UPDATE "CareGroup"
SET "tenantId" = (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
WHERE "tenantId" IS NULL;

UPDATE "Home" h
SET "tenantId" = COALESCE(cg."tenantId", (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1))
FROM "CareGroup" cg
WHERE h."careGroupId" = cg."id" AND h."tenantId" IS NULL;

UPDATE "Employee" e
SET "tenantId" = COALESCE(
  (SELECT h."tenantId" FROM "Home" h WHERE h."id" = e."homeId"),
  (SELECT u."activeTenantId" FROM "User" u WHERE u."id" = e."userId"),
  (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
)
WHERE e."tenantId" IS NULL;

UPDATE "HomeEvent" he
SET "tenantId" = COALESCE(h."tenantId", (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1))
FROM "Home" h
WHERE he."homeId" = h."id" AND he."tenantId" IS NULL;

UPDATE "EmployeeShift" es
SET "tenantId" = COALESCE(h."tenantId", (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1))
FROM "Home" h
WHERE es."homeId" = h."id" AND es."tenantId" IS NULL;

UPDATE "YoungPerson" yp
SET "tenantId" = COALESCE(h."tenantId", (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1))
FROM "Home" h
WHERE yp."homeId" = h."id" AND yp."tenantId" IS NULL;

UPDATE "Vehicle"
SET "tenantId" = (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
WHERE "tenantId" IS NULL;

UPDATE "Task" t
SET "tenantId" = COALESCE(
  (SELECT yp."tenantId" FROM "YoungPerson" yp WHERE yp."id" = t."youngPersonId"),
  (
    SELECT h."tenantId"
    FROM "Employee" e
    LEFT JOIN "Home" h ON h."id" = e."homeId"
    WHERE e."id" = t."assigneeId"
  ),
  (SELECT u."activeTenantId" FROM "User" u WHERE u."id" = t."createdById"),
  (SELECT tn."id" FROM "Tenant" tn WHERE tn."slug" = 'legacy-default' LIMIT 1)
)
WHERE t."tenantId" IS NULL;

UPDATE "Announcement" a
SET "tenantId" = COALESCE(
  (SELECT u."activeTenantId" FROM "User" u WHERE u."id" = a."authorId"),
  (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
)
WHERE a."tenantId" IS NULL;

UPDATE "Widget" w
SET "tenantId" = COALESCE(
  u."activeTenantId",
  (SELECT t."id" FROM "Tenant" t WHERE t."slug" = 'legacy-default' LIMIT 1)
)
FROM "User" u
WHERE w."userId" = u."id" AND w."tenantId" IS NULL;

UPDATE "AuditLog" al
SET "tenantId" = u."activeTenantId"
FROM "User" u
WHERE al."userId" = u."id" AND al."tenantId" IS NULL;

-- 6) Tighten constraints
ALTER TABLE "CareGroup" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Home" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "HomeEvent" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "EmployeeShift" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "YoungPerson" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Vehicle" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Task" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Announcement" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Widget" ALTER COLUMN "tenantId" SET NOT NULL;

-- 7) Replace global uniqueness with tenant-scoped uniqueness where needed
DROP INDEX IF EXISTS "CareGroup_name_key";
DROP INDEX IF EXISTS "Employee_userId_key";
DROP INDEX IF EXISTS "YoungPerson_referenceNo_key";

CREATE UNIQUE INDEX IF NOT EXISTS "CareGroup_tenantId_name_key" ON "CareGroup"("tenantId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_tenantId_userId_key" ON "Employee"("tenantId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "YoungPerson_tenantId_referenceNo_key" ON "YoungPerson"("tenantId", "referenceNo");

-- 8) Tenant indexes
CREATE INDEX IF NOT EXISTS "CareGroup_tenantId_idx" ON "CareGroup"("tenantId");
CREATE INDEX IF NOT EXISTS "Home_tenantId_idx" ON "Home"("tenantId");
CREATE INDEX IF NOT EXISTS "Employee_tenantId_idx" ON "Employee"("tenantId");
CREATE INDEX IF NOT EXISTS "HomeEvent_tenantId_startsAt_idx" ON "HomeEvent"("tenantId", "startsAt");
CREATE INDEX IF NOT EXISTS "EmployeeShift_tenantId_startTime_idx" ON "EmployeeShift"("tenantId", "startTime");
CREATE INDEX IF NOT EXISTS "YoungPerson_tenantId_idx" ON "YoungPerson"("tenantId");
CREATE INDEX IF NOT EXISTS "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");
CREATE INDEX IF NOT EXISTS "Task_tenantId_idx" ON "Task"("tenantId");
CREATE INDEX IF NOT EXISTS "Announcement_tenantId_idx" ON "Announcement"("tenantId");
CREATE INDEX IF NOT EXISTS "Widget_tenantId_idx" ON "Widget"("tenantId");
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- 9) Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CareGroup_tenantId_fkey') THEN
    ALTER TABLE "CareGroup" ADD CONSTRAINT "CareGroup_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Home_tenantId_fkey') THEN
    ALTER TABLE "Home" ADD CONSTRAINT "Home_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_tenantId_fkey') THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HomeEvent_tenantId_fkey') THEN
    ALTER TABLE "HomeEvent" ADD CONSTRAINT "HomeEvent_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeShift_tenantId_fkey') THEN
    ALTER TABLE "EmployeeShift" ADD CONSTRAINT "EmployeeShift_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'YoungPerson_tenantId_fkey') THEN
    ALTER TABLE "YoungPerson" ADD CONSTRAINT "YoungPerson_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Vehicle_tenantId_fkey') THEN
    ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_tenantId_fkey') THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Announcement_tenantId_fkey') THEN
    ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Widget_tenantId_fkey') THEN
    ALTER TABLE "Widget" ADD CONSTRAINT "Widget_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_tenantId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
