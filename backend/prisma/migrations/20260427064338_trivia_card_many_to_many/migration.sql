-- CreateEnum
CREATE TYPE "ScanOutcome" AS ENUM ('MATCH', 'MISMATCH');

-- CreateEnum
CREATE TYPE "MissionMode" AS ENUM ('TRIVIA', 'TEAMMATE');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "azureOid" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "birthMonth" INTEGER NOT NULL,
    "awards" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriviaCard" (
    "id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "clue" TEXT NOT NULL,
    "shortClue" TEXT NOT NULL,

    CONSTRAINT "TriviaCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "scannerId" TEXT NOT NULL,
    "scannedId" TEXT NOT NULL,
    "cardRef" TEXT,
    "mode" "MissionMode" NOT NULL,
    "outcome" "ScanOutcome" NOT NULL,
    "pairId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pair" (
    "id" TEXT NOT NULL,
    "kind" "MissionMode" NOT NULL,
    "hunterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "hunterConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "targetConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProgress" (
    "playerId" TEXT NOT NULL,
    "triviaStamps" JSONB NOT NULL DEFAULT '{}',
    "teammateSlots" JSONB NOT NULL DEFAULT '[]',
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProgress_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "_TriviaCardTargets" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_username_key" ON "Employee"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_azureOid_key" ON "Employee"("azureOid");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Scan_scannerId_createdAt_idx" ON "Scan"("scannerId", "createdAt");

-- CreateIndex
CREATE INDEX "Scan_pairId_idx" ON "Scan"("pairId");

-- CreateIndex
CREATE INDEX "ChatMessage_pairId_createdAt_idx" ON "ChatMessage"("pairId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "_TriviaCardTargets_AB_unique" ON "_TriviaCardTargets"("A", "B");

-- CreateIndex
CREATE INDEX "_TriviaCardTargets_B_index" ON "_TriviaCardTargets"("B");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_scannerId_fkey" FOREIGN KEY ("scannerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_scannedId_fkey" FOREIGN KEY ("scannedId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProgress" ADD CONSTRAINT "PlayerProgress_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TriviaCardTargets" ADD CONSTRAINT "_TriviaCardTargets_A_fkey" FOREIGN KEY ("A") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TriviaCardTargets" ADD CONSTRAINT "_TriviaCardTargets_B_fkey" FOREIGN KEY ("B") REFERENCES "TriviaCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
