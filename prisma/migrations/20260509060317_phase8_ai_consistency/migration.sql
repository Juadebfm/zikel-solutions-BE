-- CreateEnum
CREATE TYPE "AiCallSurface" AS ENUM ('chat', 'chat_title', 'dashboard_card', 'chronology_narrative');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('success', 'fallback', 'error', 'quota_blocked');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TenantUser" ALTER COLUMN "aiAccessEnabled" SET DEFAULT true;

-- Backfill: existing users were created under the old default (false). The
-- new design treats the per-user flag as a *deny-list* override on top of a
-- tenant-paid default-on policy. Set everyone to true; tenant Owners who
-- want to deny specific users can re-toggle via the admin UI.
UPDATE "TenantUser" SET "aiAccessEnabled" = true WHERE "aiAccessEnabled" = false;

-- CreateTable
CREATE TABLE "AiCallEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "surface" "AiCallSurface" NOT NULL,
    "model" TEXT,
    "status" "AiCallStatus" NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCallEvent_tenantId_createdAt_idx" ON "AiCallEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCallEvent_tenantId_userId_createdAt_idx" ON "AiCallEvent"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCallEvent_surface_createdAt_idx" ON "AiCallEvent"("surface", "createdAt");

-- AddForeignKey
ALTER TABLE "AiCallEvent" ADD CONSTRAINT "AiCallEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCallEvent" ADD CONSTRAINT "AiCallEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
