-- Add sliding inactivity timeout support for refresh-token sessions.

ALTER TABLE "RefreshToken"
  ADD COLUMN "idleExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes');

UPDATE "RefreshToken"
SET "idleExpiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP + INTERVAL '15 minutes');

ALTER TABLE "RefreshToken"
  ALTER COLUMN "idleExpiresAt" DROP DEFAULT;

CREATE INDEX "RefreshToken_idleExpiresAt_idx" ON "RefreshToken"("idleExpiresAt");
