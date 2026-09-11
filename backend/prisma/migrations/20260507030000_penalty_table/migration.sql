-- Move the penalty list out of the frontend's hardcoded PENALTIES array
-- (FailPenaltyPage.tsx) and into a Penalty table so admins can add/remove
-- penalties without a deploy. Pair.penaltyKey (Int index into the array)
-- becomes Pair.penaltyId (FK String to Penalty.id).
--
-- Backfill: any existing Pair row with a numeric penaltyKey gets its row
-- mapped to the seeded penalty-NN id (penalty-00..penalty-05). Out-of-range
-- keys would land on NULL after the FK is added — defensive UPDATE filters
-- those before the column drop.

CREATE TABLE "Penalty" (
    "id"   TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "Penalty_pkey" PRIMARY KEY ("id")
);

-- Seed the 6 penalties from the original frontend array, ids matching the
-- original array indices so the backfill UPDATE below is a simple LPAD.
INSERT INTO "Penalty" ("id", "text") VALUES
    ('penalty-00', 'Jumping Jacks x5'),
    ('penalty-01', 'Plank 15 Seconds'),
    ('penalty-02', 'Sit-up x5'),
    ('penalty-03', 'Jogging 30 Seconds'),
    ('penalty-04', 'Shadowboxing x20'),
    ('penalty-05', 'Squat x10');

-- Add the new FK column nullable, backfill, then drop the old key column.
ALTER TABLE "Pair" ADD COLUMN "penaltyId" TEXT;

UPDATE "Pair"
SET "penaltyId" = 'penalty-' || LPAD("penaltyKey"::text, 2, '0')
WHERE "penaltyKey" IS NOT NULL
  AND "penaltyKey" BETWEEN 0 AND 5;

ALTER TABLE "Pair" DROP COLUMN "penaltyKey";

-- FK constraint + index. SET NULL on penalty delete so an admin removing a
-- penalty mid-event doesn't blow up Pair rows (the round is already
-- decided; the FailPenaltyPage just falls back to "no penalty assigned").
ALTER TABLE "Pair"
    ADD CONSTRAINT "Pair_penaltyId_fkey"
    FOREIGN KEY ("penaltyId") REFERENCES "Penalty"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Pair_penaltyId_idx" ON "Pair"("penaltyId");
