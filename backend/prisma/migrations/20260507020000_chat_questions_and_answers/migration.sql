-- Move the chat-question list out of code (domain/chatQuestions.ts) and into
-- the DB, then add a ChatAnswer table that captures what the hunter typed as
-- the target's answer for each pair.
--
-- The `index` column on ChatQuestion is what pickQuestionForPair hashes
-- against, so the inserted rows must keep the original code-array order.
-- Renumbering or reordering would re-route an in-flight pair to a different
-- question.

CREATE TABLE "ChatQuestion" (
    "id"       TEXT    NOT NULL,
    "index"    INTEGER NOT NULL,
    "question" TEXT    NOT NULL,

    CONSTRAINT "ChatQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatQuestion_index_key" ON "ChatQuestion"("index");

CREATE TABLE "ChatAnswer" (
    "pairId"     TEXT         NOT NULL,
    "questionId" TEXT         NOT NULL,
    "answer"     TEXT         NOT NULL,
    "answererId" TEXT         NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAnswer_pkey" PRIMARY KEY ("pairId")
);
CREATE INDEX "ChatAnswer_answererId_createdAt_idx" ON "ChatAnswer"("answererId", "createdAt");
CREATE INDEX "ChatAnswer_questionId_idx" ON "ChatAnswer"("questionId");

ALTER TABLE "ChatAnswer"
    ADD CONSTRAINT "ChatAnswer_pairId_fkey"
    FOREIGN KEY ("pairId") REFERENCES "Pair"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatAnswer"
    ADD CONSTRAINT "ChatAnswer_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "ChatQuestion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChatAnswer"
    ADD CONSTRAINT "ChatAnswer_answererId_fkey"
    FOREIGN KEY ("answererId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the 20 prompts from the original CHAT_QUESTIONS array. Use $tag$
-- dollar-quoting so embedded apostrophes don't need escaping. Stable text
-- ids ("chatq-00".."chatq-19") so admin edits via PATCH preserve identity.
INSERT INTO "ChatQuestion" ("id", "index", "question") VALUES
  ('chatq-00',  0, $q$What atmosphere or event at work has impressed you the most since you joined?$q$),
  ('chatq-01',  1, $q$What is your "secret weapon" (skill or special ability) that your teammates might not know about?$q$),
  ('chatq-02',  2, $q$Who at work do you consider the most respected "Mentor"?$q$),
  ('chatq-03',  3, $q$What is your favorite color and why?$q$),
  ('chatq-04',  4, $q$What is your favorite corner or place in the office?$q$),
  ('chatq-05',  5, $q$What do you like to do on your days off when you are off the clock?$q$),
  ('chatq-06',  6, $q$The latest "song" or "movie" you listened to/watched and would like to recommend.$q$),
  ('chatq-07',  7, $q$If you had to choose between the "mountains" and the "sea", which do you prefer to visit? Why?$q$),
  ('chatq-08',  8, $q$If you had to choose one "animal" that best represents you, what would it be?$q$),
  ('chatq-09',  9, $q$What food menu item do you order immediately upon seeing it, as if hypnotized?$q$),
  ('chatq-10', 10, $q$What new challenges would you like to try at work?$q$),
  ('chatq-11', 11, $q$What kind of person do you want to see yourself as in the next 5 years?$q$),
  ('chatq-12', 12, $q$What is the most valuable "lesson" you've learned from working here?$q$),
  ('chatq-13', 13, $q$If this company is a big ship, in which direction would you like to see it sail in the future?$q$),
  ('chatq-14', 14, $q$Is there one "Wish" you'd like to happen for the company this year?$q$),
  ('chatq-15', 15, $q$Top 5 activities you like the most at work?$q$),
  ('chatq-16', 16, $q$Top 5 foods around the office you'd recommend trying?$q$),
  ('chatq-17', 17, $q$Top 5 songs you listen to most often while working?$q$),
  ('chatq-18', 18, $q$Top 5 phrases you hear most often in your team?$q$),
  ('chatq-19', 19, $q$0.5 A small dream you want to fulfill recently? (e.g., sleep doing nothing for 5 hours, drink 0.5 liters of bubble tea)$q$);
