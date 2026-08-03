-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "telegramChatId" TEXT;

-- CreateIndex
CREATE INDEX "Patient_telegramChatId_idx" ON "Patient"("telegramChatId");
