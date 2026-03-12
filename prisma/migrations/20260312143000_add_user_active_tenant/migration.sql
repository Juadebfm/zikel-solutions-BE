-- Phase 1.2: persist active tenant context on user sessions
ALTER TABLE "User"
ADD COLUMN "activeTenantId" TEXT;

CREATE INDEX "User_activeTenantId_idx" ON "User"("activeTenantId");

ALTER TABLE "User"
ADD CONSTRAINT "User_activeTenantId_fkey"
FOREIGN KEY ("activeTenantId") REFERENCES "Tenant"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
