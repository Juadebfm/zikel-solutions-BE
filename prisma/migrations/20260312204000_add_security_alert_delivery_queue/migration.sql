-- Real-time security alert pipeline queue.
CREATE TYPE "SecurityAlertType" AS ENUM (
  'repeated_auth_failures',
  'cross_tenant_attempts',
  'admin_changes',
  'break_glass_access'
);

CREATE TYPE "SecurityAlertSeverity" AS ENUM (
  'medium',
  'high'
);

CREATE TYPE "SecurityAlertDeliveryStatus" AS ENUM (
  'pending',
  'delivered',
  'failed'
);

CREATE TABLE "SecurityAlertDelivery" (
  "id" TEXT NOT NULL,
  "auditLogId" TEXT NOT NULL,
  "tenantId" TEXT,
  "userId" TEXT,
  "type" "SecurityAlertType" NOT NULL,
  "severity" "SecurityAlertSeverity" NOT NULL,
  "status" "SecurityAlertDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "payload" JSONB NOT NULL,
  "webhookUrl" TEXT,
  "dispatchedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SecurityAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityAlertDelivery_auditLogId_key" ON "SecurityAlertDelivery"("auditLogId");
CREATE INDEX "SecurityAlertDelivery_status_createdAt_idx" ON "SecurityAlertDelivery"("status", "createdAt");
CREATE INDEX "SecurityAlertDelivery_tenantId_type_createdAt_idx" ON "SecurityAlertDelivery"("tenantId", "type", "createdAt");
CREATE INDEX "SecurityAlertDelivery_userId_type_createdAt_idx" ON "SecurityAlertDelivery"("userId", "type", "createdAt");

ALTER TABLE "SecurityAlertDelivery"
  ADD CONSTRAINT "SecurityAlertDelivery_auditLogId_fkey"
  FOREIGN KEY ("auditLogId") REFERENCES "AuditLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecurityAlertDelivery"
  ADD CONSTRAINT "SecurityAlertDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SecurityAlertDelivery"
  ADD CONSTRAINT "SecurityAlertDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
