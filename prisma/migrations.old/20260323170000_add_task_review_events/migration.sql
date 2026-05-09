-- Persist per-user review evidence for acknowledgements workflow.

CREATE TABLE "TaskReviewEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskReviewEvent_taskId_userId_key" ON "TaskReviewEvent"("taskId", "userId");
CREATE INDEX "TaskReviewEvent_tenantId_userId_reviewedAt_idx" ON "TaskReviewEvent"("tenantId", "userId", "reviewedAt");
CREATE INDEX "TaskReviewEvent_taskId_idx" ON "TaskReviewEvent"("taskId");

ALTER TABLE "TaskReviewEvent"
  ADD CONSTRAINT "TaskReviewEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId")
  REFERENCES "Tenant"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "TaskReviewEvent"
  ADD CONSTRAINT "TaskReviewEvent_taskId_fkey"
  FOREIGN KEY ("taskId")
  REFERENCES "Task"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "TaskReviewEvent"
  ADD CONSTRAINT "TaskReviewEvent_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
