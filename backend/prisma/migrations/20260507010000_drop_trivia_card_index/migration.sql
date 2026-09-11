-- Drop TriviaCard.index. The column is purely a display number that's
-- derivable from the id (e.g. "CARD-01" → 1) — we now compute it on the read
-- path instead of storing it. Sort order falls back to id ASC, which is
-- equivalent for the seed-format ids ("CARD-01" < "CARD-02" lexicographically).

ALTER TABLE "TriviaCard" DROP COLUMN "index";
