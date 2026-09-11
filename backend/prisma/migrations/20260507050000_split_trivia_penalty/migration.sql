-- Split the trivia-only fields out of Pair into a dedicated TriviaPenalty
-- table (1:1 with Pair, mirrors how ChatAnswer hangs off Pair on the
-- teammate side). Pair becomes a pure "two players paired up on this kind
-- on this UTC day" record; the penalty round state lives on TriviaPenalty.
--
-- Backfill: every existing Pair row that has a non-null penaltyId is a
-- trivia mismatch — pickRandomPenaltyId is called unconditionally in the
-- mismatch path, so penaltyId IS NOT NULL is the right discriminator.
-- Teammate pairs never had a penaltyId, so they correctly get no
-- TriviaPenalty row.

CREATE TABLE "TriviaPenalty" (
    "pairId"          TEXT    NOT NULL,
    -- Nullable: an empty Penalty pool (or admin deleting a penalty
    -- mid-event) shouldn't crash the mismatch path — the round's
    -- confirmation state is still tracked, the UI just renders no text.
    "penaltyId"       TEXT,
    "targetConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "proofPhotoUrl"   TEXT,

    CONSTRAINT "TriviaPenalty_pkey" PRIMARY KEY ("pairId")
);

-- Backfill before adding FKs so referential integrity holds at FK time.
INSERT INTO "TriviaPenalty" ("pairId", "penaltyId", "targetConfirmed", "proofPhotoUrl")
SELECT "id", "penaltyId", "targetConfirmed", "proofPhotoUrl"
FROM "Pair"
WHERE "penaltyId" IS NOT NULL;

-- Cascade on Pair delete (the round state has no meaning without its pair).
-- SET NULL on Penalty delete preserves the original Pair.penaltyId semantic
-- (admin removing a penalty mid-event keeps the in-flight round, just with
-- no penalty text — matches what the FailPenaltyPage already renders for
-- a null penalty).
ALTER TABLE "TriviaPenalty"
    ADD CONSTRAINT "TriviaPenalty_pairId_fkey"
        FOREIGN KEY ("pairId") REFERENCES "Pair"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "TriviaPenalty_penaltyId_fkey"
        FOREIGN KEY ("penaltyId") REFERENCES "Penalty"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for /me/pending-penalty's `targetConfirmed = false` filter and for
-- Penalty's reverse relation count.
CREATE INDEX "TriviaPenalty_targetConfirmed_idx" ON "TriviaPenalty"("targetConfirmed");
CREATE INDEX "TriviaPenalty_penaltyId_idx" ON "TriviaPenalty"("penaltyId");

-- Drop the old Pair indexes that included targetConfirmed in the prefix —
-- the column is moving away, and the slimmer (hunterId/targetId, kind,
-- createdAt) indexes still cover the OR + orderBy used by /me/pending-penalty
-- and the admin pair list. The triviaPenalty filter joins through the FK.
DROP INDEX "Pair_hunterId_kind_targetConfirmed_createdAt_idx";
DROP INDEX "Pair_targetId_kind_targetConfirmed_createdAt_idx";
DROP INDEX "Pair_penaltyId_idx";

-- Drop the FK + columns we just relocated.
ALTER TABLE "Pair" DROP CONSTRAINT "Pair_penaltyId_fkey";
ALTER TABLE "Pair" DROP COLUMN "targetConfirmed";
ALTER TABLE "Pair" DROP COLUMN "proofPhotoUrl";
ALTER TABLE "Pair" DROP COLUMN "penaltyId";

CREATE INDEX "Pair_hunterId_kind_createdAt_idx"
    ON "Pair"("hunterId", "kind", "createdAt" DESC);
CREATE INDEX "Pair_targetId_kind_createdAt_idx"
    ON "Pair"("targetId", "kind", "createdAt" DESC);
