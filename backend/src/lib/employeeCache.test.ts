// Representative test of the TTL + single-inflight cache pattern used by
// employeeCache, triviaCardCache, penaltyCache, and photoPlaceCache. All four
// wrap a similar Map+TTL+in-flight shape; testing one of them is enough as
// a regression guard for the pattern. The siblings reference this file in
// their module comments.
//
// Note: `chatQuestions.ts` is the same pattern and is already covered by
// `domain/chatQuestions.test.ts` — this test adds coverage for the `getById`
// / `getByIds` filtering on top of the cache primitive.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/db/prisma.js', () => ({
  prisma: { employee: { findMany: mocks.findMany } },
}));

const ROSTER = [
  { id: 'E001', name: 'Alice', dept: 'ENG', year: 2024, isLeader: false },
  { id: 'E002', name: 'Bob', dept: 'ENG', year: 2023, isLeader: false },
  { id: 'E003', name: 'Cathy', dept: 'DESIGN', year: 2020, isLeader: true },
];

async function freshModule() {
  vi.resetModules();
  return import('./employeeCache.js');
}

beforeEach(() => {
  vi.useRealTimers();
  mocks.findMany.mockReset();
  mocks.findMany.mockResolvedValue(ROSTER);
});

describe('employeeCache — single-source pattern', () => {
  it('loads the full roster once and serves subsequent lookups from cache', async () => {
    const { getEmployee, getEmployeesByIds } = await freshModule();
    await getEmployee('E001');
    await getEmployee('E002');
    await getEmployeesByIds(['E003']);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('getEmployee returns the cached row by id', async () => {
    const { getEmployee } = await freshModule();
    const row = await getEmployee('E002');
    expect(row).toMatchObject({ id: 'E002', name: 'Bob' });
  });

  it('getEmployee returns null when id is not in the cache', async () => {
    const { getEmployee } = await freshModule();
    const row = await getEmployee('GHOST');
    expect(row).toBeNull();
  });

  it('getEmployeesByIds filters to ids that exist (drops unknowns silently)', async () => {
    const { getEmployeesByIds } = await freshModule();
    const rows = await getEmployeesByIds(['E001', 'GHOST', 'E003']);
    expect(rows.map((r) => r.id)).toEqual(['E001', 'E003']);
  });

  it('getEmployeesByIds short-circuits on empty input (no DB call)', async () => {
    const { getEmployeesByIds } = await freshModule();
    const rows = await getEmployeesByIds([]);
    expect(rows).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe('employeeCache — TTL', () => {
  it('refreshes from DB after 60s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00.000Z'));
    const { getEmployee } = await freshModule();
    await getEmployee('E001');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);

    // Still within TTL — cached.
    vi.setSystemTime(new Date('2026-05-11T10:00:30.000Z'));
    await getEmployee('E002');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);

    // Past 60s TTL — refresh.
    vi.setSystemTime(new Date('2026-05-11T10:01:01.000Z'));
    await getEmployee('E003');
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('employeeCache — in-flight dedup', () => {
  it('5 concurrent first-readers share one DB call', async () => {
    let release: (rows: typeof ROSTER) => void = () => {};
    const pending = new Promise<typeof ROSTER>((res) => {
      release = res;
    });
    mocks.findMany.mockReturnValueOnce(pending);

    const { getEmployee } = await freshModule();
    const calls = Array.from({ length: 5 }, (_, i) => getEmployee(`E00${(i % 3) + 1}`));
    await Promise.resolve();
    release(ROSTER);
    await Promise.all(calls);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('employeeCache — invalidate', () => {
  it('invalidateEmployeeCache forces a fresh DB read on next lookup', async () => {
    const { getEmployee, invalidateEmployeeCache } = await freshModule();
    await getEmployee('E001');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    invalidateEmployeeCache();
    await getEmployee('E002');
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
});
