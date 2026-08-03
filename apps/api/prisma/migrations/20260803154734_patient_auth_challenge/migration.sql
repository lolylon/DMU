-- CreateTable
CREATE TABLE "PatientAuthChallenge" (
    "id" TEXT NOT NULL,
    "iinHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientAuthChallenge_iinHash_createdAt_idx" ON "PatientAuthChallenge"("iinHash", "createdAt");
