import { useCallback, useEffect, useState } from 'react';

// Tiny fetch-on-mount helper for admin pages. Returns `data | null` while
// loading / on error so the caller can render skeleton / empty states without
// branching on `loading` separately when it doesn't care to.
export function useAdminData<T>(
  fetcher: () => Promise<T>,
  // Mirror useEffect's deps; the fetcher closure should be stable across these.
  deps: ReadonlyArray<unknown> = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetcher();
      setData(d);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
