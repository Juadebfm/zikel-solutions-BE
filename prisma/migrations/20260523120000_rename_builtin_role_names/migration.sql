-- Rename built-in role names to UK-domain-correct terminology.
--
-- Decision recorded in docs/role-and-membership-contract.md (2026-05-22):
--   "Care Worker"  → "Residential Care Worker"
--     Matches GOV.UK Regulated Professions Register + Skills for Care.
--     "Care Worker" alone is too generic (covers adult social care,
--     domiciliary care, etc.).
--   "Read-Only"    → "Viewer"
--     SaaS-standard access-tier label. "Auditor"/"Inspector" reserved
--     for actual Ofsted roles; "Viewer" is honest about what it is.
--
-- "Owner" and "Admin" are unchanged.
--
-- Only system-seeded rows (isSystemRole = true) are renamed. Custom roles
-- that happen to share these names (unlikely but possible) are left alone.
--
-- IMPORTANT — conflict precheck. Before applying, run:
--
--   SELECT r1."tenantId", r1.id AS system_role_id, r1.name AS old_name,
--          r2.id AS conflict_id, r2.name AS conflicting_custom_name
--   FROM "Role" r1
--   JOIN "Role" r2 ON r1."tenantId" = r2."tenantId" AND r1.id != r2.id
--   WHERE r1."isSystemRole" = true
--     AND r2."isSystemRole" = false
--     AND (
--       (r1.name = 'Care Worker' AND r2.name = 'Residential Care Worker')
--       OR (r1.name = 'Read-Only'  AND r2.name = 'Viewer')
--     );
--
-- If that returns zero rows, this migration is safe. If anything turns up,
-- rename the conflicting custom role first or the UPDATE below will fail
-- on the (tenantId, name) unique constraint.

UPDATE "Role"
SET name = 'Residential Care Worker'
WHERE name = 'Care Worker' AND "isSystemRole" = true;

UPDATE "Role"
SET name = 'Viewer'
WHERE name = 'Read-Only' AND "isSystemRole" = true;
