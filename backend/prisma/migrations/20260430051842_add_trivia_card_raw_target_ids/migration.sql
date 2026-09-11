-- AlterTable
ALTER TABLE "TriviaCard" ADD COLUMN     "rawTargetIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
