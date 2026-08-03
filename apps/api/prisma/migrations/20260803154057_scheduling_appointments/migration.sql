-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('FREE', 'BOOKED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'RESCHEDULED');

-- CreateTable
CREATE TABLE "ConsultantSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consultantUserId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "breakStart" TEXT,
    "breakEnd" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultantSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consultantUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'FREE',
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "bookedByUserId" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "caseId" TEXT,
    "channel" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "recipientRef" TEXT NOT NULL,
    "payloadMeta" JSONB,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsultantSchedule_organizationId_consultantUserId_idx" ON "ConsultantSchedule"("organizationId", "consultantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultantSchedule_consultantUserId_dayOfWeek_startTime_end_key" ON "ConsultantSchedule"("consultantUserId", "dayOfWeek", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "Slot_organizationId_startsAt_status_idx" ON "Slot"("organizationId", "startsAt", "status");

-- CreateIndex
CREATE INDEX "Slot_consultantUserId_startsAt_idx" ON "Slot"("consultantUserId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_consultantUserId_startsAt_key" ON "Slot"("consultantUserId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_slotId_key" ON "Appointment"("slotId");

-- CreateIndex
CREATE INDEX "Appointment_caseId_idx" ON "Appointment"("caseId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_status_idx" ON "Appointment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_caseId_createdAt_idx" ON "NotificationLog"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
