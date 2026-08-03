-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "emergencyKioskEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KioskDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL DEFAULT '0.1.0',
    "otaChannel" TEXT NOT NULL DEFAULT 'pilot',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "emergencyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskEmergencyEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "KioskEmergencyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrontDeskRelease" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "downloadUrl" TEXT,
    "checksumSha256" TEXT,
    "notesRu" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrontDeskRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_deviceCode_key" ON "KioskDevice"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "KioskDevice_tokenHash_key" ON "KioskDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskDevice_organizationId_enabled_idx" ON "KioskDevice"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "KioskEmergencyEvent_organizationId_status_createdAt_idx" ON "KioskEmergencyEvent"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KioskEmergencyEvent_deviceId_createdAt_idx" ON "KioskEmergencyEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FrontDeskRelease_channel_version_key" ON "FrontDeskRelease"("channel", "version");

-- CreateIndex
CREATE INDEX "FrontDeskRelease_channel_publishedAt_idx" ON "FrontDeskRelease"("channel", "publishedAt");

-- AddForeignKey
ALTER TABLE "KioskDevice" ADD CONSTRAINT "KioskDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskEmergencyEvent" ADD CONSTRAINT "KioskEmergencyEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskEmergencyEvent" ADD CONSTRAINT "KioskEmergencyEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KioskDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
