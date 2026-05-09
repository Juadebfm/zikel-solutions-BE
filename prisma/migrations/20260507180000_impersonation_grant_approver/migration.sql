-- AlterTable
ALTER TABLE "ImpersonationGrant" ADD COLUMN     "grantedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ImpersonationGrant_grantedByUserId_idx" ON "ImpersonationGrant"("grantedByUserId");

-- AddForeignKey
ALTER TABLE "ImpersonationGrant" ADD CONSTRAINT "ImpersonationGrant_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

