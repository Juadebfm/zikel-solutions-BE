-- Add audit action for sensitive read/access logging.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'record_accessed';
