-- CreateEnum
CREATE TYPE "ConclusionStatus" AS ENUM ('DRAFT', 'READY_TO_SIGN', 'SIGNED', 'DELIVERED');

-- CreateTable
CREATE TABLE "Conclusion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "status" "ConclusionStatus" NOT NULL DEFAULT 'DRAFT',
    "complaints" TEXT NOT NULL DEFAULT '',
    "anamnesis" TEXT NOT NULL DEFAULT '',
    "examination" TEXT NOT NULL DEFAULT '',
    "conclusionText" TEXT NOT NULL DEFAULT '',
    "recommendations" TEXT NOT NULL DEFAULT '',
    "authorPosition" TEXT NOT NULL DEFAULT '',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConclusionVersion" (
    "id" TEXT NOT NULL,
    "conclusionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "previousVersionId" TEXT,
    "contentJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "cmsSignature" TEXT,
    "signerIinHash" TEXT,
    "certSubject" TEXT,
    "certSerial" TEXT,
    "signatureAlg" TEXT,
    "verificationOk" BOOLEAN,
    "pdfStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConclusionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conclusion_caseId_key" ON "Conclusion"("caseId");

-- CreateIndex
CREATE INDEX "Conclusion_organizationId_status_idx" ON "Conclusion"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Conclusion_authorUserId_status_idx" ON "Conclusion"("authorUserId", "status");

-- CreateIndex
CREATE INDEX "ConclusionVersion_conclusionId_createdAt_idx" ON "ConclusionVersion"("conclusionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConclusionVersion_conclusionId_versionNumber_key" ON "ConclusionVersion"("conclusionId", "versionNumber");

-- AddForeignKey
ALTER TABLE "Conclusion" ADD CONSTRAINT "Conclusion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConclusionVersion" ADD CONSTRAINT "ConclusionVersion_conclusionId_fkey" FOREIGN KEY ("conclusionId") REFERENCES "Conclusion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
