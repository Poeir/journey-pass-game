-- Normalize PlayerProgress JSON columns into proper relational tables and
-- drop the dead pre-SSO login columns (Employee.username, Employee.passwordHash).
--
-- Steps, in order:
--   1. Create new tables and the MemoryContext enum
--   2. Backfill the new tables from the JSON columns
--   3. Drop the JSON columns and the dead login columns
--   4. Add the missing FKs (Pair, Scan.cardRef/pairId, MemoryPhoto.counterpartId,
--      PlayerProgress.assignedLeaderId)
--   5. Convert MemoryPhoto.contextKind from String to MemoryContext enum

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Create the MemoryContext enum and the three new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "MemoryContext" AS ENUM ('TRIVIA', 'TEAMMATE', 'PENALTY');

CREATE TABLE "TriviaStamp" (
    "playerId"  TEXT         NOT NULL,
    "cardId"    TEXT         NOT NULL,
    "targetId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriviaStamp_pkey" PRIMARY KEY ("playerId", "cardId")
);
CREATE INDEX "TriviaStamp_targetId_idx" ON "TriviaStamp"("targetId");

CREATE TABLE "TeammateSlot" (
    "playerId"  TEXT         NOT NULL,
    "memberId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeammateSlot_pkey" PRIMARY KEY ("playerId", "memberId")
);
CREATE INDEX "TeammateSlot_playerId_createdAt_idx" ON "TeammateSlot"("playerId", "createdAt");

CREATE TABLE "PlayerCardAssignment" (
    "playerId" TEXT    NOT NULL,
    "cardId"   TEXT    NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PlayerCardAssignment_pkey" PRIMARY KEY ("playerId", "cardId")
);
CREATE INDEX "PlayerCardAssignment_playerId_position_idx"
    ON "PlayerCardAssignment"("playerId", "position");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill from PlayerProgress JSON columns. Skip rows that reference
--    employees / cards that no longer exist (defensive — data should be clean
--    in practice but the FK adds we do later would fail on a stale ref).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "TriviaStamp" ("playerId", "cardId", "targetId")
SELECT pp."playerId", kv.key AS "cardId", kv.value AS "targetId"
FROM "PlayerProgress" pp,
     LATERAL jsonb_each_text(pp."triviaStamps") AS kv(key, value)
WHERE jsonb_typeof(pp."triviaStamps") = 'object'
  AND EXISTS (SELECT 1 FROM "TriviaCard" tc WHERE tc."id" = kv.key)
  AND EXISTS (SELECT 1 FROM "Employee" e   WHERE e."id"  = kv.value)
ON CONFLICT DO NOTHING;

INSERT INTO "TeammateSlot" ("playerId", "memberId")
SELECT pp."playerId", elem->>'id' AS "memberId"
FROM "PlayerProgress" pp,
     LATERAL jsonb_array_elements(pp."teammateSlots") AS elem
WHERE jsonb_typeof(pp."teammateSlots") = 'array'
  AND elem ? 'id'
  AND EXISTS (SELECT 1 FROM "Employee" e WHERE e."id" = elem->>'id')
ON CONFLICT DO NOTHING;

INSERT INTO "PlayerCardAssignment" ("playerId", "cardId", "position")
SELECT pp."playerId", elem.value AS "cardId", (elem.ord - 1)::int AS "position"
FROM "PlayerProgress" pp,
     LATERAL jsonb_array_elements_text(pp."assignedCardIds") WITH ORDINALITY AS elem(value, ord)
WHERE jsonb_typeof(pp."assignedCardIds") = 'array'
  AND EXISTS (SELECT 1 FROM "TriviaCard" tc WHERE tc."id" = elem.value)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Drop the JSON columns and the dead login columns.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PlayerProgress" DROP COLUMN "triviaStamps";
ALTER TABLE "PlayerProgress" DROP COLUMN "teammateSlots";
ALTER TABLE "PlayerProgress" DROP COLUMN "assignedCardIds";

DROP INDEX IF EXISTS "Employee_username_key";
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "username";
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "passwordHash";

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Foreign keys for the new tables and the previously-missing references.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TriviaStamp"
    ADD CONSTRAINT "TriviaStamp_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "PlayerProgress"("playerId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TriviaStamp"
    ADD CONSTRAINT "TriviaStamp_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "TriviaCard"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TriviaStamp"
    ADD CONSTRAINT "TriviaStamp_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeammateSlot"
    ADD CONSTRAINT "TeammateSlot_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "PlayerProgress"("playerId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeammateSlot"
    ADD CONSTRAINT "TeammateSlot_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlayerCardAssignment"
    ADD CONSTRAINT "PlayerCardAssignment_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "PlayerProgress"("playerId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerCardAssignment"
    ADD CONSTRAINT "PlayerCardAssignment_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "TriviaCard"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Pair (hunter, target) → Employee
ALTER TABLE "Pair"
    ADD CONSTRAINT "Pair_hunterId_fkey"
    FOREIGN KEY ("hunterId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Pair"
    ADD CONSTRAINT "Pair_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Scan.cardRef → TriviaCard, Scan.pairId → Pair (both nullable, SET NULL)
ALTER TABLE "Scan"
    ADD CONSTRAINT "Scan_cardRef_fkey"
    FOREIGN KEY ("cardRef") REFERENCES "TriviaCard"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Scan"
    ADD CONSTRAINT "Scan_pairId_fkey"
    FOREIGN KEY ("pairId") REFERENCES "Pair"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Scan_cardRef_idx" ON "Scan"("cardRef");

-- MemoryPhoto.counterpartId → Employee. uploaderId already had its FK from
-- the table-creation migration; only counterpartId was missing.
ALTER TABLE "MemoryPhoto"
    ADD CONSTRAINT "MemoryPhoto_counterpartId_fkey"
    FOREIGN KEY ("counterpartId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- PlayerProgress.assignedLeaderId → Employee (nullable, SET NULL)
ALTER TABLE "PlayerProgress"
    ADD CONSTRAINT "PlayerProgress_assignedLeaderId_fkey"
    FOREIGN KEY ("assignedLeaderId") REFERENCES "Employee"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Convert MemoryPhoto.contextKind from text to MemoryContext enum.
--    Existing values are lowercase 'trivia' | 'teammate' | 'penalty'.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "MemoryPhoto"
    ALTER COLUMN "contextKind" TYPE "MemoryContext"
    USING (
        CASE "contextKind"
            WHEN 'trivia'   THEN 'TRIVIA'::"MemoryContext"
            WHEN 'teammate' THEN 'TEAMMATE'::"MemoryContext"
            WHEN 'penalty'  THEN 'PENALTY'::"MemoryContext"
        END
    );
