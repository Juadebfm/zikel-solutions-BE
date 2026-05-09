-- Enforce append-only behavior for audit logs.
-- Update/delete attempts are blocked at the database layer.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only and cannot be modified.';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'audit_log_no_update'
      AND tgrelid = '"AuditLog"'::regclass
  ) THEN
    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON "AuditLog"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_mutation();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'audit_log_no_delete'
      AND tgrelid = '"AuditLog"'::regclass
  ) THEN
    CREATE TRIGGER audit_log_no_delete
      BEFORE DELETE ON "AuditLog"
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_log_mutation();
  END IF;
END $$;
