-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due_grace', 'past_due_readonly', 'suspended', 'cancelled', 'incomplete');

-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "BillingEventKind" AS ENUM ('subscription_created', 'subscription_updated', 'subscription_deleted', 'invoice_paid', 'invoice_payment_failed', 'payment_method_updated', 'topup_purchased', 'tenant_grandfathered', 'manual_admin_override', 'quota_reset', 'webhook_received');

-- CreateEnum
CREATE TYPE "TokenLedgerEntryKind" AS ENUM ('debit_chat', 'debit_chat_title', 'debit_dashboard_card', 'debit_chronology_narrative', 'credit_topup', 'credit_period_reset', 'credit_grandfather', 'credit_admin_override', 'credit_refund');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'trialing';

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" "PlanInterval" NOT NULL,
    "unitAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "bundledCallsPerPeriod" INTEGER NOT NULL,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpPack" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "calls" INTEGER NOT NULL,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pastDueSince" TIMESTAMP(3),
    "manuallyOverriddenUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountDueMinor" INTEGER NOT NULL,
    "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hostedInvoiceUrl" TEXT,
    "pdfUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" "BillingEventKind" NOT NULL,
    "stripeEventId" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "bundledCalls" INTEGER NOT NULL,
    "topUpCalls" INTEGER NOT NULL DEFAULT 0,
    "usedCalls" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "TokenLedgerEntryKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "reasonRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantAiRestriction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "perRoleCaps" JSONB NOT NULL DEFAULT '{}',
    "perUserCaps" JSONB NOT NULL DEFAULT '{}',
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAiRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripePriceId_key" ON "Plan"("stripePriceId");

-- CreateIndex
CREATE INDEX "Plan_isActive_idx" ON "Plan"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpPack_code_key" ON "TopUpPack"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpPack_stripePriceId_key" ON "TopUpPack"("stripePriceId");

-- CreateIndex
CREATE INDEX "TopUpPack_isActive_idx" ON "TopUpPack"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_pastDueSince_idx" ON "Subscription"("pastDueSince");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_createdAt_idx" ON "Invoice"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_stripePaymentMethodId_key" ON "PaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentMethod_tenantId_isDefault_idx" ON "PaymentMethod"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_stripeEventId_key" ON "BillingEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_tenantId_kind_receivedAt_idx" ON "BillingEvent"("tenantId", "kind", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingEvent_kind_receivedAt_idx" ON "BillingEvent"("kind", "receivedAt");

-- CreateIndex
CREATE INDEX "TokenAllocation_tenantId_resetAt_idx" ON "TokenAllocation"("tenantId", "resetAt");

-- CreateIndex
CREATE INDEX "TokenAllocation_resetAt_idx" ON "TokenAllocation"("resetAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenAllocation_tenantId_periodStart_key" ON "TokenAllocation"("tenantId", "periodStart");

-- CreateIndex
CREATE INDEX "TokenLedgerEntry_tenantId_createdAt_idx" ON "TokenLedgerEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenLedgerEntry_allocationId_createdAt_idx" ON "TokenLedgerEntry"("allocationId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenLedgerEntry_tenantId_userId_createdAt_idx" ON "TokenLedgerEntry"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiRestriction_tenantId_key" ON "TenantAiRestriction"("tenantId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenAllocation" ADD CONSTRAINT "TokenAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedgerEntry" ADD CONSTRAINT "TokenLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedgerEntry" ADD CONSTRAINT "TokenLedgerEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "TokenAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenLedgerEntry" ADD CONSTRAINT "TokenLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiRestriction" ADD CONSTRAINT "TenantAiRestriction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiRestriction" ADD CONSTRAINT "TenantAiRestriction_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "TenantUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
