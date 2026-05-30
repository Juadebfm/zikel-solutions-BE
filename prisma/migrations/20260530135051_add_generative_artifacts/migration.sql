-- CreateEnum
CREATE TYPE "GenerativeArtifactType" AS ENUM ('daily_log_summary');

-- CreateEnum
CREATE TYPE "GenerativeArtifactStatus" AS ENUM ('draft', 'edited', 'committed', 'superseded');

-- CreateTable
CREATE TABLE "GenerativeArtifact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "artifactType" "GenerativeArtifactType" NOT NULL,
    "status" "GenerativeArtifactStatus" NOT NULL DEFAULT 'draft',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceRecordIds" JSONB NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "draftContent" JSONB NOT NULL,
    "currentContent" JSONB NOT NULL,
    "committedContent" JSONB,
    "createdById" TEXT NOT NULL,
    "committedById" TEXT,
    "committedAt" TIMESTAMP(3),
    "editHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerativeArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLogSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "summaryDate" DATE NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLogSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerativeArtifact_tenantId_artifactType_createdAt_idx" ON "GenerativeArtifact"("tenantId", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "GenerativeArtifact_tenantId_entityType_entityId_idx" ON "GenerativeArtifact"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "GenerativeArtifact_status_idx" ON "GenerativeArtifact"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLogSummary_artifactId_key" ON "DailyLogSummary"("artifactId");

-- CreateIndex
CREATE INDEX "DailyLogSummary_tenantId_homeId_summaryDate_idx" ON "DailyLogSummary"("tenantId", "homeId", "summaryDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLogSummary_tenantId_homeId_summaryDate_key" ON "DailyLogSummary"("tenantId", "homeId", "summaryDate");

-- AddForeignKey
ALTER TABLE "GenerativeArtifact" ADD CONSTRAINT "GenerativeArtifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerativeArtifact" ADD CONSTRAINT "GenerativeArtifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TenantUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerativeArtifact" ADD CONSTRAINT "GenerativeArtifact_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogSummary" ADD CONSTRAINT "DailyLogSummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogSummary" ADD CONSTRAINT "DailyLogSummary_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogSummary" ADD CONSTRAINT "DailyLogSummary_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "GenerativeArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
