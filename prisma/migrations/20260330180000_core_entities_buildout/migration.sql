-- ─── Role model ──────────────────────────────────────────────────────────────

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystemGenerated" BOOLEAN NOT NULL DEFAULT false,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");

ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Home — new fields ──────────────────────────────────────────────────────

ALTER TABLE "Home" ADD COLUMN "description" TEXT;
ALTER TABLE "Home" ADD COLUMN "postCode" TEXT;
ALTER TABLE "Home" ADD COLUMN "category" TEXT;
ALTER TABLE "Home" ADD COLUMN "region" TEXT;
ALTER TABLE "Home" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'current';
ALTER TABLE "Home" ADD COLUMN "phoneNumber" TEXT;
ALTER TABLE "Home" ADD COLUMN "email" TEXT;
ALTER TABLE "Home" ADD COLUMN "adminUserId" TEXT;
ALTER TABLE "Home" ADD COLUMN "personInChargeId" TEXT;
ALTER TABLE "Home" ADD COLUMN "responsibleIndividualId" TEXT;
ALTER TABLE "Home" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Home" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "Home" ADD COLUMN "isSecure" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Home" ADD COLUMN "shortTermStays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Home" ADD COLUMN "minAgeGroup" INTEGER;
ALTER TABLE "Home" ADD COLUMN "maxAgeGroup" INTEGER;
ALTER TABLE "Home" ADD COLUMN "ofstedUrn" TEXT;
ALTER TABLE "Home" ADD COLUMN "compliance" JSONB;

CREATE INDEX "Home_status_idx" ON "Home"("status");

ALTER TABLE "Home" ADD CONSTRAINT "Home_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Home" ADD CONSTRAINT "Home_personInChargeId_fkey"
    FOREIGN KEY ("personInChargeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Home" ADD CONSTRAINT "Home_responsibleIndividualId_fkey"
    FOREIGN KEY ("responsibleIndividualId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── YoungPerson — new fields ────────────────────────────────────────────────

ALTER TABLE "YoungPerson" ADD COLUMN "preferredName" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "namePronunciation" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "description" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "gender" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "ethnicity" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "religion" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "niNumber" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "roomNumber" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'current';
ALTER TABLE "YoungPerson" ADD COLUMN "type" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "admissionDate" TIMESTAMP(3);
ALTER TABLE "YoungPerson" ADD COLUMN "placementEndDate" TIMESTAMP(3);
ALTER TABLE "YoungPerson" ADD COLUMN "avatarFileId" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "keyWorkerId" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "practiceManagerId" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "adminUserId" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "socialWorkerName" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "independentReviewingOfficer" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "placingAuthority" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "legalStatus" TEXT;
ALTER TABLE "YoungPerson" ADD COLUMN "isEmergencyPlacement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "YoungPerson" ADD COLUMN "isAsylumSeeker" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "YoungPerson" ADD COLUMN "contact" JSONB;
ALTER TABLE "YoungPerson" ADD COLUMN "health" JSONB;
ALTER TABLE "YoungPerson" ADD COLUMN "education" JSONB;

CREATE INDEX "YoungPerson_status_idx" ON "YoungPerson"("status");

ALTER TABLE "YoungPerson" ADD CONSTRAINT "YoungPerson_avatarFileId_fkey"
    FOREIGN KEY ("avatarFileId") REFERENCES "UploadedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "YoungPerson" ADD CONSTRAINT "YoungPerson_keyWorkerId_fkey"
    FOREIGN KEY ("keyWorkerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "YoungPerson" ADD CONSTRAINT "YoungPerson_practiceManagerId_fkey"
    FOREIGN KEY ("practiceManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "YoungPerson" ADD CONSTRAINT "YoungPerson_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Vehicle — new fields ────────────────────────────────────────────────────

ALTER TABLE "Vehicle" ADD COLUMN "description" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'current';
ALTER TABLE "Vehicle" ADD COLUMN "vin" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "registrationDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "taxDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "fuelType" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "insuranceDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "ownership" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "leaseStartDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "leaseEndDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "purchasePrice" DECIMAL(65,30);
ALTER TABLE "Vehicle" ADD COLUMN "purchaseDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "adminUserId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "contactPhone" TEXT;

CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- ─── Employee — new fields ───────────────────────────────────────────────────

ALTER TABLE "Employee" ADD COLUMN "roleId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "endDate" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'current';
ALTER TABLE "Employee" ADD COLUMN "contractType" TEXT;
ALTER TABLE "Employee" ADD COLUMN "dbsNumber" TEXT;
ALTER TABLE "Employee" ADD COLUMN "dbsDate" TIMESTAMP(3);
ALTER TABLE "Employee" ADD COLUMN "qualifications" JSONB;

CREATE INDEX "Employee_roleId_idx" ON "Employee"("roleId");
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
