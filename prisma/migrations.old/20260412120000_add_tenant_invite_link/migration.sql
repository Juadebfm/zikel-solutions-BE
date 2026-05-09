-- Invite-link onboarding enums (referenced by auth / membership flows)
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'staff_activation';

-- Reusable org invite links (public codes; distinct from TenantInvite email tokens)
CREATE TABLE "TenantInviteLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "defaultRole" "TenantRole" NOT NULL DEFAULT 'staff',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInviteLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantInviteLink_code_key" ON "TenantInviteLink"("code");
CREATE INDEX "TenantInviteLink_tenantId_idx" ON "TenantInviteLink"("tenantId");
CREATE INDEX "TenantInviteLink_code_idx" ON "TenantInviteLink"("code");
CREATE INDEX "TenantInviteLink_createdById_idx" ON "TenantInviteLink"("createdById");

ALTER TABLE "TenantInviteLink"
ADD CONSTRAINT "TenantInviteLink_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantInviteLink"
ADD CONSTRAINT "TenantInviteLink_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
