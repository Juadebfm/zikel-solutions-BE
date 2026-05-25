-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "maxHomes" INTEGER,
ADD COLUMN     "maxSeats" INTEGER,
ADD COLUMN     "pricePerBedMinor" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "bedCountSnapshot" INTEGER,
ADD COLUMN     "lastUsageReportedAt" TIMESTAMP(3),
ADD COLUMN     "maxHomesOverride" INTEGER,
ADD COLUMN     "maxSeatsOverride" INTEGER;
