-- Rename the first ServiceOfInterest enum value to the new label.
-- The first value is the legacy option created in the initial migration.
DO $$
DECLARE
  first_label text;
BEGIN
  SELECT e.enumlabel
    INTO first_label
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'ServiceOfInterest'
  ORDER BY e.enumsortorder
  LIMIT 1;

  IF first_label IS DISTINCT FROM 'care_documentation_platform' THEN
    EXECUTE format(
      'ALTER TYPE "ServiceOfInterest" RENAME VALUE %L TO %L',
      first_label,
      'care_documentation_platform'
    );
  END IF;
END $$;
