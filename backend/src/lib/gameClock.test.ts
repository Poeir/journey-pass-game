import { describe, it, expect, beforeEach, vi } from 'vitest';

// `env` in config.ts captures process.env at module-load time, so to test
// different env permutations we mock @/config.js per-test and re-import
// gameClock.js (resetModules) so it picks up the freshly-mocked env.
async function loadClockWithEnv(envOverrides: {
  GAME_NOW_OVERRIDE?: string;
  GAME_END_AT?: string;
}) {
  vi.resetModules();
  vi.doMock('@/config.js', () => ({
    env: {
      GAME_NOW_OVERRIDE: envOverrides.GAME_NOW_OVERRIDE,
      GAME_END_AT: envOverrides.GAME_END_AT,
    },
    isProd: false,
  }));
  return import('@/lib/gameClock.js');
}

describe('gameClock', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('gameNow()', () => {
    it('returns the GAME_NOW_OVERRIDE date when set', async () => {
      const { gameNow } = await loadClockWithEnv({
        GAME_NOW_OVERRIDE: '2026-05-11T10:00:00.000Z',
      });
      expect(gameNow().toISOString()).toBe('2026-05-11T10:00:00.000Z');
    });

    it('returns real wall-clock time when override is not set', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
      const { gameNow } = await loadClockWithEnv({});
      expect(gameNow().toISOString()).toBe('2026-05-11T12:00:00.000Z');
    });
  });

  describe('gameEndAt()', () => {
    it('returns GAME_END_AT verbatim when set', async () => {
      const { gameEndAt } = await loadClockWithEnv({
        GAME_END_AT: '2026-05-11T20:00:00.000Z',
      });
      expect(gameEndAt().toISOString()).toBe('2026-05-11T20:00:00.000Z');
    });

    it('defaults to BKK 17:00 of the current day (= 10:00 UTC)', async () => {
      const { gameEndAt } = await loadClockWithEnv({
        // Noon BKK on 2026-05-11 = 05:00 UTC. End should be 17:00 BKK same day = 10:00 UTC.
        GAME_NOW_OVERRIDE: '2026-05-11T05:00:00.000Z',
      });
      expect(gameEndAt().toISOString()).toBe('2026-05-11T10:00:00.000Z');
    });

    it('BKK +07:00 boundary: now=2026-05-11T18:00:00Z (= 01:00 BKK 12 May) → endAt is 12 May 17:00 BKK', async () => {
      // 2026-05-11T18:00Z is 2026-05-12T01:00 in Bangkok. The end of "that day
      // in BKK" is 2026-05-12T17:00+07:00 = 2026-05-12T10:00 UTC.
      const { gameEndAt } = await loadClockWithEnv({
        GAME_NOW_OVERRIDE: '2026-05-11T18:00:00.000Z',
      });
      expect(gameEndAt().toISOString()).toBe('2026-05-12T10:00:00.000Z');
    });
  });

  describe('isGameEnded()', () => {
    it('returns true when gameNow >= gameEndAt', async () => {
      const { isGameEnded } = await loadClockWithEnv({
        GAME_NOW_OVERRIDE: '2026-05-11T11:00:00.000Z',
        GAME_END_AT: '2026-05-11T10:00:00.000Z',
      });
      expect(isGameEnded()).toBe(true);
    });

    it('returns false when gameNow < gameEndAt', async () => {
      const { isGameEnded } = await loadClockWithEnv({
        GAME_NOW_OVERRIDE: '2026-05-11T09:59:59.999Z',
        GAME_END_AT: '2026-05-11T10:00:00.000Z',
      });
      expect(isGameEnded()).toBe(false);
    });

    it('returns true at the exact tick of gameEndAt (>= boundary)', async () => {
      const { isGameEnded } = await loadClockWithEnv({
        GAME_NOW_OVERRIDE: '2026-05-11T10:00:00.000Z',
        GAME_END_AT: '2026-05-11T10:00:00.000Z',
      });
      expect(isGameEnded()).toBe(true);
    });
  });
});
