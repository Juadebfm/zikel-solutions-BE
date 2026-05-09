-- Add dynamic form template catalog and task submission payload fields.

CREATE TABLE "FormTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "group" TEXT NOT NULL,
  "schemaJson" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormTemplate_key_key" ON "FormTemplate"("key");
CREATE INDEX "FormTemplate_name_idx" ON "FormTemplate"("name");
CREATE INDEX "FormTemplate_group_idx" ON "FormTemplate"("group");
CREATE INDEX "FormTemplate_isActive_idx" ON "FormTemplate"("isActive");

ALTER TABLE "Task"
  ADD COLUMN "formTemplateKey" TEXT,
  ADD COLUMN "formName" TEXT,
  ADD COLUMN "formGroup" TEXT,
  ADD COLUMN "submissionPayload" JSONB,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "submittedById" TEXT,
  ADD COLUMN "updatedById" TEXT;

CREATE INDEX "Task_formTemplateKey_idx" ON "Task"("formTemplateKey");
CREATE INDEX "Task_formGroup_idx" ON "Task"("formGroup");
CREATE INDEX "Task_submittedById_idx" ON "Task"("submittedById");
CREATE INDEX "Task_updatedById_idx" ON "Task"("updatedById");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_formTemplateKey_fkey"
  FOREIGN KEY ("formTemplateKey")
  REFERENCES "FormTemplate"("key")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
