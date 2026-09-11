import { describe, it, expect, beforeEach, vi } from 'vitest';

// The module holds its `store` + `inflight` Maps at module scope, so we reset
// modules per test for fully clean state. (`invalidate(key)` only clears the
// `store` entry, not the in-flight promise.)
async function freshModule() {
  vi.resetModules();
  return import('./ttlCache.js');
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('ttlCached — cache reuse', () => {
  it('returns the cached value for the same key within TTL', async () => {
    const { ttlCached } = await freshModule();
    const loader = vi.fn(async () => 'fresh');
    const a = await ttlCached('k1', 60_000, loader);
    const b = await ttlCached('k1', 60_000, loader);
    expect(a).toBe('fresh');
    expect(b).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('different keys do not share entries', async () => {
    const { ttlCached } = await freshModule();
    const loader = vi.fn(async () => 'x');
    await ttlCached('k1', 60_000, loader);
    await ttlCached('k2', 60_000, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('ttlCached — TTL expiry', () => {
  it('re-loads after the TTL elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T10:00:00.000Z'));
    const { ttlCached } = await freshModule();
    const loader = vi.fn(async () => 'v');
    await ttlCached('k', 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // Within TTL — still cached.
    vi.setSystemTime(new Date('2026-05-11T10:00:00.500Z'));
    await ttlCached('k', 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);

    // Past TTL — refresh.
    vi.setSystemTime(new Date('2026-05-11T10:00:02.000Z'));
    await ttlCached('k', 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('invalidate', () => {
  it('forces the next call to re-load', async () => {
    const { ttlCached, invalidate } = await freshModule();
    const loader = vi.fn(async () => 'v');
    await ttlCached('k', 60_000, loader);
    invalidate('k');
    await ttlCached('k', 60_000, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('invalidating an unknown key is a no-op (does not throw)', async () => {
    const { invalidate } = await freshModule();
    expect(() => invalidate('does-not-exist')).not.toThrow();
  });
});

describe('ttlCached — stampede prevention (in-flight dedup)', () => {
  it('5 concurrent callers during cache miss → loader runs once', async () => {
    let release: (v: string) => void = () => {};
    const pending = new Promise<string>((res) => {
      release = res;
    });
    const loader = vi.fn(() => pending);

    const { ttlCached } = await freshModule();
    const calls = Array.from({ length: 5 }, () => ttlCached('k', 60_000, loader));

    // All 5 should be parked on the same in-flight promise.
    expect(loader).toHaveBeenCalledTimes(1);

    release('v');
    const results = await Promise.all(calls);
    expect(results).toEqual(['v', 'v', 'v', 'v', 'v']);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('ttlCached — error propagation', () => {
  it('loader throw → in-flight is cleared so the next call retries', async () => {
    const { ttlCached } = await freshModule();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(ttlCached('k', 60_000, loader)).rejects.toThrow('boom');
    // Without inflight clear, the retry would await a rejected promise forever
    // — verify the retry actually invokes the loader again and succeeds.
    const v = await ttlCached('k', 60_000, loader);
    expect(v).toBe('ok');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
