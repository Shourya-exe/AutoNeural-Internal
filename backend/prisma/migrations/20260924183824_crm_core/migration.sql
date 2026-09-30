-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('FILE', 'DOCUMENT', 'LINK');

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('REFERENCE', 'OUTPUT', 'FOR_APPROVAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RemovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'WEBSITE', 'FACEBOOK', 'WHATSAPP', 'CALL', 'REFERRAL', 'IMPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'FOLLOW_UP', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'ATTACHMENT_ADDED';
ALTER TYPE "ActivityAction" ADD VALUE 'ATTACHMENT_REMOVED';
ALTER TYPE "ActivityAction" ADD VALUE 'SUBMISSION_FOR_APPROVAL';
ALTER TYPE "ActivityAction" ADD VALUE 'SUBMISSION_APPROVED';
ALTER TYPE "ActivityAction" ADD VALUE 'SUBMISSION_REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REMOVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVAL_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'REMOVAL_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'ATTACHMENT_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBMISSION_FOR_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE 'SUBMISSION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBMISSION_REJECTED';

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'IN_REVIEW';

-- CreateTable
CREATE TABLE "employee_removal_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "status" "RemovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "employee_removal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "url" TEXT NOT NULL,
    "storagePath" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "purpose" "AttachmentPurpose" NOT NULL DEFAULT 'OUTPUT',
    "approvalStatus" "ApprovalStatus",
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "industry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "leadStatus" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deal_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT,
    "stageId" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCloseDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "dealId" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT NOT NULL,
    "type" "CrmActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "outcome" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_removal_requests_organizationId_status_idx" ON "employee_removal_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "employee_removal_requests_employeeId_idx" ON "employee_removal_requests"("employeeId");

-- CreateIndex
CREATE INDEX "task_attachments_taskId_idx" ON "task_attachments"("taskId");

-- CreateIndex
CREATE INDEX "task_attachments_uploaderId_idx" ON "task_attachments"("uploaderId");

-- CreateIndex
CREATE INDEX "accounts_organizationId_name_idx" ON "accounts"("organizationId", "name");

-- CreateIndex
CREATE INDEX "contacts_organizationId_phone_idx" ON "contacts"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "contacts_organizationId_email_idx" ON "contacts"("organizationId", "email");

-- CreateIndex
CREATE INDEX "contacts_organizationId_ownerId_leadStatus_idx" ON "contacts"("organizationId", "ownerId", "leadStatus");

-- CreateIndex
CREATE INDEX "deal_stages_organizationId_position_idx" ON "deal_stages"("organizationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "deal_stages_organizationId_name_key" ON "deal_stages"("organizationId", "name");

-- CreateIndex
CREATE INDEX "deals_organizationId_status_stageId_idx" ON "deals"("organizationId", "status", "stageId");

-- CreateIndex
CREATE INDEX "deals_organizationId_ownerId_idx" ON "deals"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "deals_contactId_idx" ON "deals"("contactId");

-- CreateIndex
CREATE INDEX "crm_activities_contactId_createdAt_idx" ON "crm_activities"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_activities_organizationId_ownerId_completedAt_dueAt_idx" ON "crm_activities"("organizationId", "ownerId", "completedAt", "dueAt");

-- AddForeignKey
ALTER TABLE "employee_removal_requests" ADD CONSTRAINT "employee_removal_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_removal_requests" ADD CONSTRAINT "employee_removal_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_removal_requests" ADD CONSTRAINT "employee_removal_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_removal_requests" ADD CONSTRAINT "employee_removal_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stages" ADD CONSTRAINT "deal_stages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "deal_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
