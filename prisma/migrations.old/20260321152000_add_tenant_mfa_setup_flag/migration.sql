-- Persist one-time tenant MFA setup completion to prevent repeated setup prompts.
ALTER TABLE "Tenant"
ADD COLUMN IF NOT EXISTS "mfaSetupCompletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Tenant_mfaSetupCompletedAt_idx"
ON "Tenant"("mfaSetupCompletedAt");

-- Backfill organizations that already completed MFA challenge verification.
UPDATE "Tenant" AS t
SET "mfaSetupCompletedAt" = src.first_verified_at
FROM (
  SELECT
    (metadata ->> 'activeTenantId') AS tenant_id,
    MIN("createdAt") AS first_verified_at
  FROM "AuditLog"
  WHERE
    action = 'otp_verified'
    AND "entityType" = 'auth_mfa'
    AND metadata IS NOT NULL
    AND COALESCE(metadata ->> 'activeTenantId', '') <> ''
  GROUP BY (metadata ->> 'activeTenantId')
) AS src
WHERE t.id = src.tenant_id
  AND t."mfaSetupCompletedAt" IS NULL;
