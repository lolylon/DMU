-- CreateTable
CREATE TABLE "ProfileQueueItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileCode" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedConsultantId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileQueueItem_caseId_key" ON "ProfileQueueItem"("caseId");

-- CreateIndex
CREATE INDEX "ProfileQueueItem_organizationId_profileCode_status_createdA_idx" ON "ProfileQueueItem"("organizationId", "profileCode", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfileQueueItem" ADD CONSTRAINT "ProfileQueueItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
