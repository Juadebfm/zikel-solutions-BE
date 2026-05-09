/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `PlatformRefreshToken` table. All the data in the column will be lost.
  - You are about to drop the column `expiresAt` on the `RefreshToken` table. All the data in the column will be lost.
  - Added the required column `sessionId` to the `PlatformRefreshToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sessionId` to the `RefreshToken` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PlatformRefreshToken" DROP COLUMN "expiresAt",
ADD COLUMN     "replacedByTokenId" TEXT,
ADD COLUMN     "sessionId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RefreshToken" DROP COLUMN "expiresAt",
ADD COLUMN     "replacedByTokenId" TEXT,
ADD COLUMN     "sessionId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "mfaVerifiedAt" TIMESTAMP(3),
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "mfaVerifiedAt" TIMESTAMP(3),
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSession_platformUserId_idx" ON "PlatformSession"("platformUserId");

-- CreateIndex
CREATE INDEX "PlatformSession_revokedAt_idx" ON "PlatformSession"("revokedAt");

-- CreateIndex
CREATE INDEX "PlatformSession_absoluteExpiresAt_idx" ON "PlatformSession"("absoluteExpiresAt");

-- CreateIndex
CREATE INDEX "TenantSession_userId_idx" ON "TenantSession"("userId");

-- CreateIndex
CREATE INDEX "TenantSession_revokedAt_idx" ON "TenantSession"("revokedAt");

-- CreateIndex
CREATE INDEX "TenantSession_absoluteExpiresAt_idx" ON "TenantSession"("absoluteExpiresAt");

-- CreateIndex
CREATE INDEX "PlatformRefreshToken_sessionId_idx" ON "PlatformRefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "PlatformRefreshToken_idleExpiresAt_idx" ON "PlatformRefreshToken"("idleExpiresAt");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRefreshToken" ADD CONSTRAINT "PlatformRefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlatformSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformRefreshToken" ADD CONSTRAINT "PlatformRefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "PlatformRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSession" ADD CONSTRAINT "TenantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TenantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
