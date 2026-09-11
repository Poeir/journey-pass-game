import { createHash } from 'node:crypto';
import { prisma } from '@/db/prisma.js';

// Chat questions are now stored in the DB (table `ChatQuestion`). This module
// keeps a 60s in-memory cache mirroring `triviaCardCache` so the per-pair
// pick stays an O(1) hash lookup. `index` is the stable ordinal that
// pickQuestionForPair hashes against — callers must not assume contiguous
// or 0-based indexing if an admin removes a row, but the seed inserts 0..19.

interface CachedQuestion {
  id: string;
  index: number;
  question: string;
}

const TTL_MS = 60_000;

let cache: { expiresAt: number; ordered: CachedQuestion[] } | null = null;
let inflight: Promise<CachedQuestion[]> | null = null;

async function loadAll(): Promise<CachedQuestion[]> {
  const rows = await prisma.chatQuestion.findMany({
    orderBy: { index: 'asc' },
    select: { id: true, index: true, question: true },
  });
  cache = { expiresAt: Date.now() + TTL_MS, ordered: rows };
  return rows;
}

async function getOrdered(): Promise<CachedQuestion[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.ordered;
  if (inflight) return inflight;
  const p = loadAll().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

export function invalidateChatQuestionCache(): void {
  cache = null;
}

export interface ChatQuestionPick {
  id: string;
  question: string;
}

/**
 * Deterministic per-pair pick. Hashes pairId, modulos by the row count, and
 * picks the question at that ordinal in the index-sorted list. Both sides of
 * the pair (and reload-the-page) see the same question.
 */
export async function pickQuestionForPair(pairId: string): Promise<ChatQuestionPick> {
  const ordered = await getOrdered();
  if (ordered.length === 0) {
    throw new Error('No chat questions seeded — run prisma migrate + seed');
  }
  const hash = createHash('sha256').update(`chat-question:${pairId}`).digest('hex');
  const idx = parseInt(hash.slice(0, 8), 16) % ordered.length;
  const picked = ordered[idx];
  return { id: picked.id, question: picked.question };
}
