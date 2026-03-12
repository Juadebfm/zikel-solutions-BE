ALTER TABLE "Task"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Task_deletedAt_idx" ON "Task"("deletedAt");

ALTER TABLE "Announcement"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Announcement_deletedAt_idx" ON "Announcement"("deletedAt");
