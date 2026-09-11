-- Allow both sides of a teammate pair to record their own chat-confirm answer.
-- Previously ChatAnswer was keyed by pairId alone (one row per pair) and only
-- the hunter ever wrote it. The mutual-add flow has each side answer
-- independently and add their own slot on confirm, so the row is now keyed
-- by (pairId, answererId).

ALTER TABLE "ChatAnswer" DROP CONSTRAINT "ChatAnswer_pkey";
ALTER TABLE "ChatAnswer" ADD CONSTRAINT "ChatAnswer_pkey" PRIMARY KEY ("pairId", "answererId");
