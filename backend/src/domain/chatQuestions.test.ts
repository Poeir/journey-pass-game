import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mock: lets each test inject its own findMany behaviour.
const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));
vi.mock('@/db/prisma.js', () => ({
  prisma: {
    chatQuestion: {
      findMany: mocks.findMany,
    },
  },
}));

const QUESTIONS = Array.from({ length: 20 }, (_, i) => ({
  id: `Q${i}`,
  index: i,
  question: `Question ${i}?`,
}));

// We reset modules per test to clear the module-level cache state cleanly,
// then re-import the module under test. invalidateChatQuestionCache exists,
// but the inflight promise lives in module scope too — resetModules is the
// safest reset.
async function freshModule() {
  vi.resetModules();
  return import('./chatQuestions.js');
}

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.findMany.mockResolvedValue(QUESTIONS);
  vi.useRealTimers();
});

describe('pickQuestionForPair — determinism', () => {
  it('returns the same question for the same pairId across calls', async () => {
    const { pickQuestionForPair } = await freshModule();
    const a = await pickQuestionForPair('pair-1');
    const b = await pickQuestionForPair('pair-1');
    expect(a.id).toBe(b.id);
    expect(a.question).toBe(b.question);
  });

  it('runs of 10 calls per pairId are stable', async () => {
    const { pickQuestionForPair } = await freshModule();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => pickQuestionForPair('pair-stable')),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
  });

  it('returns a member of the seeded pool', async () => {
    const { pickQuestionForPair } = await freshModule();
    const picked = await pickQuestionForPair('pair-1');
    expect(QUESTIONS.map((q) => q.id)).toContain(picked.id);
  });
});

describe('pickQuestionForPair — distribution sanity', () => {
  it('does not collapse to a single question across 1000 random pairIds', async () => {
    const { pickQuestionForPair } = await freshModule();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const pick = await pickQuestionForPair(`pair-${i}`);
      ids.add(pick.id);
    }
    // With 20 questions and 1000 hashes, we'd expect ~all 20 to appear.
    // Allow some slack but reject anything that looks broken.
    expect(ids.size).toBeGreaterThanOrEqual(15);
  });
});

describe('pickQuestionForPair — cache TTL', () => {
  it('hits the DB once for two calls within 60s (cache reused)', async () => {
    const { pickQuestionForPair } = await freshModule();
    await pickQuestionForPair('p1');
    await pickQuestionForPair('p2');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it('refreshes from DB after the 60s TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00.000Z'));
    const { pickQuestionForPair } = await freshModule();
    await pickQuestionForPair('p1');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);

    // Advance past 60s TTL.
    vi.setSystemTime(new Date('2026-05-11T10:01:01.000Z'));
    await pickQuestionForPair('p2');
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('pickQuestionForPair — in-flight dedup', () => {
  it('10 concurrent calls during cache miss → loader runs once', async () => {
    // Hold the DB call open until we let it resolve.
    let release: (rows: typeof QUESTIONS) => void = () => {};
    const pending = new Promise<typeof QUESTIONS>((res) => {
      release = res;
    });
    mocks.findMany.mockReturnValueOnce(pending);

    const { pickQuestionForPair } = await freshModule();

    const calls = Array.from({ length: 10 }, (_, i) => pickQuestionForPair(`p${i}`));
    // Let the test pump the microtask queue before releasing.
    await Promise.resolve();
    release(QUESTIONS);
    await Promise.all(calls);

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('pickQuestionForPair — empty pool', () => {
  it('throws a clear error when no questions are seeded', async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    const { pickQuestionForPair } = await freshModule();
    await expect(pickQuestionForPair('p1')).rejects.toThrow(/No chat questions seeded/);
  });
});

describe('invalidateChatQuestionCache', () => {
  it('forces the next call to re-read from DB', async () => {
    const { pickQuestionForPair, invalidateChatQuestionCache } = await freshModule();
    await pickQuestionForPair('p1');
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    invalidateChatQuestionCache();
    await pickQuestionForPair('p2');
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
});
