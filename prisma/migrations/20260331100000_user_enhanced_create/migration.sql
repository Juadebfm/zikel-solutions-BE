-- User enhanced create fields
ALTER TABLE "User" ADD COLUMN "userType" TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE "User" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "otherNames" TEXT;
ALTER TABLE "User" ADD COLUMN "landingPage" TEXT;
ALTER TABLE "User" ADD COLUMN "hideFutureTasks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "enableIpRestriction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordExpiresInstantly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "disableLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordExpiresAt" TIMESTAMP(3);
