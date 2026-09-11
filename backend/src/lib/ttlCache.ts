// In-memory TTL cache for high-read public endpoints (projector polling).
// Single in-flight promise per key — concurrent callers during a refresh share
// the same DB hit instead of stampeding.

interface Entry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function ttlCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = (async () => {
    try {
      const value = await loader();
      store.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidate(key: string): void {
  store.delete(key);
}
