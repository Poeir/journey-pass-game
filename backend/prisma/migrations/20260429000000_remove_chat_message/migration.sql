-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_pairId_fkey";

-- DropTable
DROP TABLE "ChatMessage";
