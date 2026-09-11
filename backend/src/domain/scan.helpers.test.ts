import { describe, it, expect, vi } from 'vitest';

// Pure helpers in domain/scan.ts. Importing scan.ts pulls in prisma + caches,
// so we mock them out — the helpers themselves don't use the mocked modules,
// but the import side-effects would otherwise fail.
vi.mock('@/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/lib/employeeCache.js', () => ({ getEmployeesByIds: vi.fn() }));
vi.mock('@/lib/triviaCardCache.js', () => ({ getTriviaCard: vi.fn() }));
vi.mock('@/lib/penaltyCache.js', () => ({ pickRandomPenaltyId: vi.fn() }));
vi.mock('@/ws/hub.js', () => ({ broadcastToUser: vi.fn() }));
vi.mock('@/lib/gameClock.js', () => ({ isGameEnded: vi.fn(() => false) }));

const { inSameYearGroup, toEmployeeShape } = await import('./scan.js');

describe('inSameYearGroup — SENIOR_COHORT_CUTOFF = 2023', () => {
  it('two seniors (both < 2023) are in the same cohort', () => {
    expect(inSameYearGroup(2022, 2021)).toBe(true);
    expect(inSameYearGroup(2019, 2018)).toBe(true);
    expect(inSameYearGroup(2010, 2022)).toBe(true);
  });

  it('boundary: 2022 vs 2023 are NOT the same cohort', () => {
    expect(inSameYearGroup(2022, 2023)).toBe(false);
    expect(inSameYearGroup(2023, 2022)).toBe(false);
  });

  it('post-cutoff years match only on exact equality', () => {
    expect(inSameYearGroup(2023, 2023)).toBe(true);
    expect(inSameYearGroup(2024, 2024)).toBe(true);
    expect(inSameYearGroup(2023, 2024)).toBe(false);
    expect(inSameYearGroup(2025, 2023)).toBe(false);
  });

  it('symmetric: a vs b === b vs a', () => {
    const pairs: Array<[number, number]> = [
      [2022, 2021],
      [2022, 2023],
      [2023, 2024],
      [2020, 2020],
    ];
    for (const [a, b] of pairs) {
      expect(inSameYearGroup(a, b)).toBe(inSameYearGroup(b, a));
    }
  });
});

describe('toEmployeeShape', () => {
  it('derives `initial` from name.charAt(0)', () => {
    const e = toEmployeeShape({
      id: 'E001',
      name: 'Alice',
      dept: 'ENG',
      year: 2024,
    });
    expect(e.initial).toBe('A');
  });

  it('defaults `isLeader` to false when not provided', () => {
    const e = toEmployeeShape({
      id: 'E001',
      name: 'Bob',
      dept: 'ENG',
      year: 2024,
    });
    expect(e.isLeader).toBe(false);
  });

  it('preserves `isLeader=true` when explicitly true', () => {
    const e = toEmployeeShape({
      id: 'E001',
      name: 'Leader',
      dept: 'ENG',
      year: 2020,
      isLeader: true,
    });
    expect(e.isLeader).toBe(true);
  });

  it('treats `isLeader=false` (explicit) as false', () => {
    const e = toEmployeeShape({
      id: 'E001',
      name: 'Bob',
      dept: 'ENG',
      year: 2024,
      isLeader: false,
    });
    expect(e.isLeader).toBe(false);
  });

  it('passes through id, name, dept, year', () => {
    const e = toEmployeeShape({
      id: 'E042',
      name: 'Charlie',
      dept: 'DESIGN',
      year: 2024,
    });
    expect(e).toMatchObject({
      id: 'E042',
      name: 'Charlie',
      dept: 'DESIGN',
      year: 2024,
    });
  });

  it('initial of empty name is empty string', () => {
    const e = toEmployeeShape({
      id: 'E001',
      name: '',
      dept: 'ENG',
      year: 2024,
    });
    expect(e.initial).toBe('');
  });
});
