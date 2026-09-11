import { env } from '@/config.js';

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function gameNow(): Date {
  return env.GAME_NOW_OVERRIDE ? new Date(env.GAME_NOW_OVERRIDE) : new Date();
}

export function gameEndAt(): Date {
  if (env.GAME_END_AT) return new Date(env.GAME_END_AT);
  const now = gameNow();
  const bkk = new Date(now.getTime() + BKK_OFFSET_MS);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bkk.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T17:00:00+07:00`);
}

export function isGameEnded(): boolean {
  return gameNow().getTime() >= gameEndAt().getTime();
}
