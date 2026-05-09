-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('totp');

-- CreateTable
CREATE TABLE "PlatformMfaCredential" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "type" "MfaType" NOT NULL DEFAULT 'totp',
    "secretEncrypted" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformMfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformMfaBackupCode" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMfaBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMfaCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MfaType" NOT NULL DEFAULT 'totp',
    "secretEncrypted" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "TenantMfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMfaBackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMfaBackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformMfaCredential_platformUserId_key" ON "PlatformMfaCredential"("platformUserId");

-- CreateIndex
CREATE INDEX "PlatformMfaBackupCode_platformUserId_idx" ON "PlatformMfaBackupCode"("platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMfaCredential_userId_key" ON "TenantMfaCredential"("userId");

-- CreateIndex
CREATE INDEX "TenantMfaBackupCode_userId_idx" ON "TenantMfaBackupCode"("userId");

-- AddForeignKey
ALTER TABLE "PlatformMfaCredential" ADD CONSTRAINT "PlatformMfaCredential_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformMfaBackupCode" ADD CONSTRAINT "PlatformMfaBackupCode_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMfaCredential" ADD CONSTRAINT "TenantMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMfaBackupCode" ADD CONSTRAINT "TenantMfaBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
