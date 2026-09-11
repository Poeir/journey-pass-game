// In-memory cache of the PhotoPlace table. Same pattern as penaltyCache /
// triviaCardCache: 60s TTL, single in-flight load. Mutated only by admin
// routes which call invalidatePhotoPlaceCache() afterwards.

import { prisma } from '@/db/prisma.js';

interface CachedPlace {
  id: string;
  text: string;
}

const TTL_MS = 60_000;

let cache: { expiresAt: number; ordered: CachedPlace[] } | null = null;
let inflight: Promise<CachedPlace[]> | null = null;

async function loadAll(): Promise<CachedPlace[]> {
  const rows = await prisma.photoPlace.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, text: true },
  });
  cache = { expiresAt: Date.now() + TTL_MS, ordered: rows };
  return rows;
}

export async function getAllPhotoPlaces(): Promise<CachedPlace[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.ordered;
  if (inflight) return inflight;
  const p = loadAll().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

export function invalidatePhotoPlaceCache(): void {
  cache = null;
}
