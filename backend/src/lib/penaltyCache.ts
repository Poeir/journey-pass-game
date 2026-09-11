// In-memory cache of the Penalty table. Same pattern as triviaCardCache /
// chatQuestion cache: 60s TTL, single in-flight load, mutated only by admin
// routes which call invalidatePenaltyCache() afterwards.

import { prisma } from '@/db/prisma.js';

interface CachedPenalty {
  id: string;
  text: string;
}

const TTL_MS = 60_000;

let cache: { expiresAt: number; ordered: CachedPenalty[]; byId: Map<string, CachedPenalty> } | null = null;
let inflight: Promise<CachedPenalty[]> | null = null;

async function loadAll(): Promise<CachedPenalty[]> {
  const rows = await prisma.penalty.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, text: true },
  });
  cache = {
    expiresAt: Date.now() + TTL_MS,
    ordered: rows,
    byId: new Map(rows.map((r) => [r.id, r])),
  };
  return rows;
}

async function getOrdered(): Promise<CachedPenalty[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.ordered;
  if (inflight) return inflight;
  const p = loadAll().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

export function invalidatePenaltyCache(): void {
  cache = null;
}

export async function getPenalty(id: string): Promise<CachedPenalty | null> {
  await getOrdered();
  return cache?.byId.get(id) ?? null;
}

/**
 * Pick a uniformly-random penalty id. Returns null when the table is empty,
 * which lets `processScan` create a Pair without a penalty rather than crash.
 */
export async function pickRandomPenaltyId(): Promise<string | null> {
  const ordered = await getOrdered();
  if (ordered.length === 0) return null;
  const idx = Math.floor(Math.random() * ordered.length);
  return ordered[idx].id;
}
