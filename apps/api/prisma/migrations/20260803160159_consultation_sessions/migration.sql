-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING_RECORDING', 'LIVE', 'ENDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('STARTING', 'ACTIVE', 'FINALIZING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "ConsultationSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "livekitRoomName" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING_RECORDING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'STARTING',
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "byteSize" INTEGER,
    "egressId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFile" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_livekitRoomName_key" ON "ConsultationSession"("livekitRoomName");

-- CreateIndex
CREATE INDEX "ConsultationSession_caseId_idx" ON "ConsultationSession"("caseId");

-- CreateIndex
CREATE INDEX "ConsultationSession_organizationId_status_idx" ON "ConsultationSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SessionParticipant_userId_idx" ON "SessionParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_sessionId_userId_key" ON "SessionParticipant"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_sessionId_key" ON "SessionRecording"("sessionId");

-- CreateIndex
CREATE INDEX "ChatMessage_caseId_createdAt_idx" ON "ChatMessage"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "CaseFile_caseId_createdAt_idx" ON "CaseFile"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConsultationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecording" ADD CONSTRAINT "SessionRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConsultationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConsultationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConsultationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
