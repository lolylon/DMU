-- CreateEnum
CREATE TYPE "MisOutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'MANUAL_PENDING', 'MANUAL_DONE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "catalogAddress" TEXT,
ADD COLUMN     "catalogCity" TEXT,
ADD COLUMN     "catalogPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "misMode" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "CatalogOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileCode" TEXT NOT NULL,
    "titleRu" TEXT NOT NULL,
    "titleKk" TEXT NOT NULL,
    "descriptionRu" TEXT NOT NULL DEFAULT '',
    "descriptionKk" TEXT NOT NULL DEFAULT '',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" "MisOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MisOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MisInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualBridgeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "referralNumber" TEXT,
    "renderedAt" TIMESTAMP(3),
    "enteredInMis" BOOLEAN NOT NULL DEFAULT false,
    "enteredInMisAt" TIMESTAMP(3),
    "enteredByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualBridgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDossier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "assemblyMs" INTEGER NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseDossier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogOffer_organizationId_active_idx" ON "CatalogOffer"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOffer_organizationId_profileCode_key" ON "CatalogOffer"("organizationId", "profileCode");

-- CreateIndex
CREATE UNIQUE INDEX "MisOutbox_idempotencyKey_key" ON "MisOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MisOutbox_organizationId_status_createdAt_idx" ON "MisOutbox"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MisOutbox_caseId_idx" ON "MisOutbox"("caseId");

-- CreateIndex
CREATE INDEX "MisInbox_organizationId_createdAt_idx" ON "MisInbox"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MisInbox_organizationId_externalId_key" ON "MisInbox"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualBridgeEntry_caseId_key" ON "ManualBridgeEntry"("caseId");

-- CreateIndex
CREATE INDEX "ManualBridgeEntry_organizationId_enteredInMis_renderedAt_idx" ON "ManualBridgeEntry"("organizationId", "enteredInMis", "renderedAt");

-- CreateIndex
CREATE INDEX "CaseDossier_caseId_createdAt_idx" ON "CaseDossier"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseDossier_organizationId_createdAt_idx" ON "CaseDossier"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CatalogOffer" ADD CONSTRAINT "CatalogOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisOutbox" ADD CONSTRAINT "MisOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisOutbox" ADD CONSTRAINT "MisOutbox_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisInbox" ADD CONSTRAINT "MisInbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualBridgeEntry" ADD CONSTRAINT "ManualBridgeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualBridgeEntry" ADD CONSTRAINT "ManualBridgeEntry_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
