-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('PATIENT', 'AMBULATORY_WORKER', 'CONSULTANT', 'REGISTRAR', 'DEPARTMENT_HEAD', 'ORG_ADMIN', 'AUDITOR', 'TECH_IMPLEMENTATION', 'TECH_SUPPORT', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('CREATED', 'AWAITING_CONSENT', 'AWAITING_BOOKING', 'BOOKED', 'IN_SESSION', 'AWAITING_CONCLUSION', 'AWAITING_SIGNATURE', 'AWAITING_PATIENT_DELIVERY', 'CLOSED', 'CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'OVERDUE');

-- CreateEnum
CREATE TYPE "CaseMode" AS ENUM ('REALTIME', 'ASYNC');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'onboarding',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nameKk" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "iinHash" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "iinHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "mode" "CaseMode" NOT NULL DEFAULT 'REALTIME',
    "status" "CaseStatus" NOT NULL DEFAULT 'CREATED',
    "profileCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseStatusHistory" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStatus" "CaseStatus",
    "toStatus" "CaseStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseParticipant" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,

    CONSTRAINT "CaseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT,

    CONSTRAINT "ConsentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAcceptance" (
    "id" TEXT NOT NULL,
    "consentDocumentId" TEXT NOT NULL,
    "caseId" TEXT,
    "patientId" TEXT,
    "method" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAtTz" TEXT NOT NULL,
    "ip" TEXT,
    "deviceId" TEXT,
    "mediatorName" TEXT,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "ConsentAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "organizationId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechActionLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "payloadMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_bin_key" ON "Organization"("bin");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_role_key" ON "Membership"("userId", "organizationId", "role");

-- CreateIndex
CREATE INDEX "Patient_organizationId_idx" ON "Patient"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_organizationId_iinHash_key" ON "Patient"("organizationId", "iinHash");

-- CreateIndex
CREATE INDEX "Case_organizationId_status_idx" ON "Case"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Case_patientId_idx" ON "Case"("patientId");

-- CreateIndex
CREATE INDEX "CaseStatusHistory_caseId_createdAt_idx" ON "CaseStatusHistory"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaseParticipant_caseId_userId_role_key" ON "CaseParticipant"("caseId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentDocument_kind_version_language_organizationId_key" ON "ConsentDocument"("kind", "version", "language", "organizationId");

-- CreateIndex
CREATE INDEX "AccessLog_organizationId_createdAt_idx" ON "AccessLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AccessLog_objectType_objectId_idx" ON "AccessLog"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "TechActionLog_organizationId_createdAt_idx" ON "TechActionLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStatusHistory" ADD CONSTRAINT "CaseStatusHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParticipant" ADD CONSTRAINT "CaseParticipant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAcceptance" ADD CONSTRAINT "ConsentAcceptance_consentDocumentId_fkey" FOREIGN KEY ("consentDocumentId") REFERENCES "ConsentDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLog" ADD CONSTRAINT "AccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
