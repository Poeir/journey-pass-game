/*
  Warnings:

  - You are about to drop the column `hunterConfirmed` on the `Pair` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "isLeader" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Pair" DROP COLUMN "hunterConfirmed",
ADD COLUMN     "proofPhotoUrl" TEXT;

-- AlterTable
ALTER TABLE "PlayerProgress" ADD COLUMN     "assignedCardIds" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "MemoryPhoto" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "counterpartId" TEXT NOT NULL,
    "contextKind" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryPhoto_uploaderId_createdAt_idx" ON "MemoryPhoto"("uploaderId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemoryPhoto" ADD CONSTRAINT "MemoryPhoto_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
