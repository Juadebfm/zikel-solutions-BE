-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('signature', 'task_attachment', 'task_document', 'announcement_image', 'general');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'uploaded', 'failed');

-- CreateTable
CREATE TABLE "UploadedFile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "uploadedById" TEXT,
  "storageKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "purpose" "UploadPurpose" NOT NULL DEFAULT 'general',
  "status" "UploadStatus" NOT NULL DEFAULT 'pending',
  "checksumSha256" TEXT,
  "etag" TEXT,
  "metadata" JSONB,
  "uploadedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_storageKey_key" ON "UploadedFile"("storageKey");
CREATE INDEX "UploadedFile_tenantId_purpose_status_idx" ON "UploadedFile"("tenantId", "purpose", "status");
CREATE INDEX "UploadedFile_tenantId_createdAt_idx" ON "UploadedFile"("tenantId", "createdAt");
CREATE INDEX "UploadedFile_uploadedById_idx" ON "UploadedFile"("uploadedById");
CREATE INDEX "UploadedFile_deletedAt_idx" ON "UploadedFile"("deletedAt");

-- AddForeignKey
ALTER TABLE "UploadedFile"
  ADD CONSTRAINT "UploadedFile_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UploadedFile"
  ADD CONSTRAINT "UploadedFile_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
