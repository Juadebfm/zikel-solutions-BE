-- AlterTable
ALTER TABLE "PlatformMfaCredential" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantMfaCredential" ADD COLUMN     "confirmedAt" TIMESTAMP(3);
