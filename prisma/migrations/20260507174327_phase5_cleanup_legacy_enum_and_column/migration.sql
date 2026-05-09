-- AlterEnum
BEGIN;
CREATE TYPE "MembershipStatus_new" AS ENUM ('invited', 'active', 'suspended', 'revoked');
ALTER TABLE "public"."TenantMembership" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TenantMembership" ALTER COLUMN "status" TYPE "MembershipStatus_new" USING ("status"::text::"MembershipStatus_new");
ALTER TYPE "MembershipStatus" RENAME TO "MembershipStatus_old";
ALTER TYPE "MembershipStatus_new" RENAME TO "MembershipStatus";
DROP TYPE "public"."MembershipStatus_old";
ALTER TABLE "TenantMembership" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "mfaSetupCompletedAt";

