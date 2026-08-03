-- CreateTable
CREATE TABLE "OrgReadinessItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "labelRu" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgReadinessItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgReadinessItem_organizationId_required_done_idx" ON "OrgReadinessItem"("organizationId", "required", "done");

-- CreateIndex
CREATE UNIQUE INDEX "OrgReadinessItem_organizationId_key_key" ON "OrgReadinessItem"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "OrgReadinessItem" ADD CONSTRAINT "OrgReadinessItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
