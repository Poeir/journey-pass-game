-- Performance indexes for 200-user concurrent load.

-- /me/pending-penalty queries Pair by (hunterId | targetId) + kind + targetConfirmed,
-- ordered by createdAt desc. Two composite indexes (one per side of the OR) let
-- Postgres do a BitmapOr without scanning the whole table.
CREATE INDEX IF NOT EXISTS "Pair_hunterId_kind_targetConfirmed_createdAt_idx"
  ON "Pair" ("hunterId", "kind", "targetConfirmed", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Pair_targetId_kind_targetConfirmed_createdAt_idx"
  ON "Pair" ("targetId", "kind", "targetConfirmed", "createdAt" DESC);

-- /completion/list and /completion/ranking filter on completedAt IS NOT NULL.
CREATE INDEX IF NOT EXISTS "PlayerProgress_completedAt_idx"
  ON "PlayerProgress" ("completedAt");

-- /memories/wall does ORDER BY createdAt DESC LIMIT 200 across the whole table.
CREATE INDEX IF NOT EXISTS "MemoryPhoto_createdAt_idx"
  ON "MemoryPhoto" ("createdAt" DESC);
