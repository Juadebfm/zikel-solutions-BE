/*
  Warnings:

  - You are about to drop the column `roleId` on the `Employee` table. All the data in the column will be lost.
  - You are about to drop the column `isActive` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `isSystemGenerated` on the `Role` table. All the data in the column will be lost.
  - The `permissions` column on the `Role` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `role` on the `TenantMembership` table. All the data in the column will be lost.
  - Added the required column `roleId` to the `TenantMembership` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_roleId_fkey";

-- DropIndex
DROP INDEX "Employee_roleId_idx";

-- DropIndex
DROP INDEX "TenantMembership_tenantId_role_idx";

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "roleId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "isActive",
DROP COLUMN "isSystemGenerated",
ADD COLUMN     "isAssignable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystemRole" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "tenantId" DROP NOT NULL,
DROP COLUMN "permissions",
ADD COLUMN     "permissions" TEXT[];

-- AlterTable
ALTER TABLE "TenantMembership" DROP COLUMN "role",
ADD COLUMN     "roleId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Role_isSystemRole_idx" ON "Role"("isSystemRole");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_roleId_idx" ON "TenantMembership"("tenantId", "roleId");

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
