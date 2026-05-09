/*
  Warnings:

  - You are about to drop the column `additionalInfo` on the `DemoRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DemoRequest" DROP COLUMN "additionalInfo",
ADD COLUMN     "message" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisation" TEXT,
    "serviceOfInterest" "ServiceOfInterest" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistEntry_email_idx" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");
