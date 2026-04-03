-- Phase 3: Safeguarding risk escalation alerts.

CREATE TYPE "SafeguardingRiskAlertType" AS ENUM (
  'high_severity_incident',
  'repeated_incident_pattern',
  'rejected_approval_spike',
  'overdue_high_priority_tasks',
  'critical_home_event_signal'
);

CREATE TYPE "SafeguardingRiskAlertSeverity" AS ENUM (
  'medium',
  'high',
  'critical'
);

CREATE TYPE "SafeguardingRiskAlertStatus" AS ENUM (
  'new',
  'acknowledged',
  'in_progress',
  'resolved'
);

CREATE TYPE "SafeguardingRiskAlertTargetType" AS ENUM (
  'tenant',
  'home',
  'young_person'
);

CREATE TABLE "SafeguardingRiskAlert" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "SafeguardingRiskAlertType" NOT NULL,
  "severity" "SafeguardingRiskAlertSeverity" NOT NULL,
  "status" "SafeguardingRiskAlertStatus" NOT NULL DEFAULT 'new',
  "targetType" "SafeguardingRiskAlertTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "homeId" TEXT,
  "youngPersonId" TEXT,
  "ruleKey" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" JSONB,
  "windowStart" TIMESTAMP(3),
  "windowEnd" TIMESTAMP(3),
  "firstTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggeredCount" INTEGER NOT NULL DEFAULT 1,
  "ownerUserId" TEXT,
  "acknowledgedById" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "lastEvaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SafeguardingRiskAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafeguardingRiskAlertNote" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "isEscalation" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SafeguardingRiskAlertNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafeguardingRiskAlert_tenantId_dedupeKey_key" ON "SafeguardingRiskAlert"("tenantId", "dedupeKey");
CREATE INDEX "SafeguardingRiskAlert_tenantId_status_severity_updatedAt_idx" ON "SafeguardingRiskAlert"("tenantId", "status", "severity", "updatedAt");
CREATE INDEX "SafeguardingRiskAlert_tenantId_type_lastTriggeredAt_idx" ON "SafeguardingRiskAlert"("tenantId", "type", "lastTriggeredAt");
CREATE INDEX "SafeguardingRiskAlert_homeId_status_idx" ON "SafeguardingRiskAlert"("homeId", "status");
CREATE INDEX "SafeguardingRiskAlert_youngPersonId_status_idx" ON "SafeguardingRiskAlert"("youngPersonId", "status");
CREATE INDEX "SafeguardingRiskAlert_ownerUserId_status_idx" ON "SafeguardingRiskAlert"("ownerUserId", "status");

CREATE INDEX "SafeguardingRiskAlertNote_alertId_createdAt_idx" ON "SafeguardingRiskAlertNote"("alertId", "createdAt");
CREATE INDEX "SafeguardingRiskAlertNote_tenantId_createdAt_idx" ON "SafeguardingRiskAlertNote"("tenantId", "createdAt");
CREATE INDEX "SafeguardingRiskAlertNote_userId_idx" ON "SafeguardingRiskAlertNote"("userId");

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_youngPersonId_fkey"
  FOREIGN KEY ("youngPersonId") REFERENCES "YoungPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlert"
  ADD CONSTRAINT "SafeguardingRiskAlert_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlertNote"
  ADD CONSTRAINT "SafeguardingRiskAlertNote_alertId_fkey"
  FOREIGN KEY ("alertId") REFERENCES "SafeguardingRiskAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlertNote"
  ADD CONSTRAINT "SafeguardingRiskAlertNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SafeguardingRiskAlertNote"
  ADD CONSTRAINT "SafeguardingRiskAlertNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
