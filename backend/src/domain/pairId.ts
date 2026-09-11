import { createHash } from 'node:crypto';
import type { MissionMode } from '@prisma/client';
import { gameNow } from '@/lib/gameClock.js';

export function deterministicPairId(
  scannerId: string,
  scannedId: string,
  kind: MissionMode,
  dayBucket: string = gameNow().toISOString().slice(0, 10),
): string {
  // TRIVIA: symmetric — one shared penalty pair per (A, B) per day.
  // TEAMMATE: directional — each scanner gets their own pair so both sides
  // can independently add each other to their own teams.
  const [lo, hi] =
    kind === 'TEAMMATE' ? [scannerId, scannedId] : [scannerId, scannedId].sort();
  return createHash('sha256').update(`${lo}:${hi}:${kind}:${dayBucket}`).digest('hex').slice(0, 16);
}
