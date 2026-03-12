-- Phase 1.3: tokenized tenant invitation flow
CREATE TABLE "TenantInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantInvite_tokenHash_key" ON "TenantInvite"("tokenHash");
CREATE INDEX "TenantInvite_tenantId_email_idx" ON "TenantInvite"("tenantId", "email");
CREATE INDEX "TenantInvite_tenantId_role_idx" ON "TenantInvite"("tenantId", "role");
CREATE INDEX "TenantInvite_tenantId_expiresAt_idx" ON "TenantInvite"("tenantId", "expiresAt");
CREATE INDEX "TenantInvite_invitedById_idx" ON "TenantInvite"("invitedById");
CREATE INDEX "TenantInvite_acceptedByUserId_idx" ON "TenantInvite"("acceptedByUserId");

ALTER TABLE "TenantInvite"
ADD CONSTRAINT "TenantInvite_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantInvite"
ADD CONSTRAINT "TenantInvite_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TenantInvite"
ADD CONSTRAINT "TenantInvite_acceptedByUserId_fkey"
FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
