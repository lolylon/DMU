-- AlterTable
ALTER TABLE "KioskDevice" ADD COLUMN "pairCodeHash" TEXT,
ADD COLUMN "pairExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_pairCodeHash_key" ON "KioskDevice"("pairCodeHash");
