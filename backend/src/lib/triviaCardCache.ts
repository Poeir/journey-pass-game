// In-memory cache of the entire TriviaCard table. Cards are read-only at
// runtime (mutated only by `npm run seed`) — load all rows once with their
// target ids and serve every per-card lookup, list, and "is X a target of card
// Y?" check from memory. 60s TTL leaves a window for `npm run seed` re-runs
// to take effect without a server restart, mirroring `employeeCache`.

import { prisma } from '@/db/prisma.js';

export interface CachedTriviaCard {
  id: string;
  index: number;
  clue: string;
  targetIds: string[];
}

const TTL_MS = 60_000;

// Derive a 1-based display number from the card id (e.g. "CARD-01" → 1).
// Cards whose ids don't end in digits get 0 — admin UIs that show "#0" can
// be a hint to rename to the standard "CARD-NN" format.
export function deriveCardIndex(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

let cache: { expiresAt: number; byId: Map<string, CachedTriviaCard>; ordered: CachedTriviaCard[] } | null = null;
let inflight: Promise<Map<string, CachedTriviaCard>> | null = null;

async function loadAll(): Promise<Map<string, CachedTriviaCard>> {
  const rows = await prisma.triviaCard.findMany({
    include: { targets: { select: { id: true } } },
  });
  const cards: CachedTriviaCard[] = rows.map((r) => ({
    id: r.id,
    index: deriveCardIndex(r.id),
    clue: r.clue,
    targetIds: r.targets.map((t) => t.id),
  }));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = cards.slice().sort((a, b) => a.id.localeCompare(b.id));
  cache = { expiresAt: Date.now() + TTL_MS, byId, ordered };
  return byId;
}

async function getMap(): Promise<Map<string, CachedTriviaCard>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.byId;
  if (inflight) return inflight;
  const p = loadAll().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

export async function getTriviaCard(id: string): Promise<CachedTriviaCard | null> {
  const map = await getMap();
  return map.get(id) ?? null;
}

export async function getTriviaCardsByIds(ids: string[]): Promise<CachedTriviaCard[]> {
  if (ids.length === 0) return [];
  const map = await getMap();
  const out: CachedTriviaCard[] = [];
  for (const id of ids) {
    const c = map.get(id);
    if (c) out.push(c);
  }
  return out;
}

// All cards, ordered by `index` ascending. Cheap snapshot — callers that need
// to mutate (e.g. shuffle in /missions/trivia/start) MUST copy first.
export async function getAllTriviaCardsOrdered(): Promise<CachedTriviaCard[]> {
  await getMap();
  return cache!.ordered;
}

// Clues for every card whose `targetIds` includes the given employee, in
// `index` order — powers GET /me/criteria without a relation query.
export async function getCriteriaClues(employeeId: string): Promise<string[]> {
  await getMap();
  return cache!.ordered.filter((c) => c.targetIds.includes(employeeId)).map((c) => c.clue);
}

export function invalidateTriviaCardCache(): void {
  cache = null;
}
