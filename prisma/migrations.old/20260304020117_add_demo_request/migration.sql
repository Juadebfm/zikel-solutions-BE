-- CreateEnum
CREATE TYPE "ServiceOfInterest" AS ENUM ('digital_filing_cabinet', 'ai_staff_guidance', 'training_development', 'healthcare_workflow', 'general_enquiry');

-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "organisationName" TEXT,
    "rolePosition" TEXT,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "numberOfStaffChildren" TEXT,
    "serviceOfInterest" "ServiceOfInterest" NOT NULL,
    "keyChallenges" TEXT,
    "additionalInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoRequest_email_idx" ON "DemoRequest"("email");

-- CreateIndex
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");
