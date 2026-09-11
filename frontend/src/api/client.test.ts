import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the cross-store dependencies so we can assert side effects without
// rendering anything. `useGame` and `useErrorStore` are imported by client.ts
// at the top level — hoisted mocks must be in place before `api` is loaded.
const setProfileMock = vi.hoisted(() => vi.fn());
const pushToastMock = vi.hoisted(() => vi.fn());

vi.mock('@/game/gameStore', () => ({
  useGame: { getState: () => ({ setProfile: setProfileMock }) },
}));
vi.mock('@/lib/errorStore', () => ({
  useErrorStore: { getState: () => ({ push: pushToastMock }) },
  describeHttpError: (status: number, code?: string) =>
    code ? `${status}-${code}` : `${status}`,
}));

const { api, ApiError } = await import('./client');

// jsdom's window.location.assign is a no-op that doesn't actually navigate,
// but it isn't a vi.fn by default. Replace it with a spy per test. The real
// `assign` is on the location prototype — easiest is to swap the whole object.
function setLocation(pathname: string): {
  assign: ReturnType<typeof vi.fn>;
} {
  const assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { pathname, assign: assignMock, href: `http://localhost${pathname}` },
    writable: true,
    configurable: true,
  });
  return { assign: assignMock };
}

function mockFetchResponse(status: number, body?: unknown): void {
  const json = vi.fn().mockResolvedValue(body ?? {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    ok: status >= 200 && status < 300,
    status,
    json,
    clone: () => res,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn().mockResolvedValue(res);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('api.get — happy path', () => {
  it('parses JSON 200 response', async () => {
    setLocation('/user');
    mockFetchResponse(200, { hello: 'world' });
    const body = await api.get<{ hello: string }>('/me');
    expect(body).toEqual({ hello: 'world' });
  });

  it('returns undefined for 204 No Content', async () => {
    setLocation('/user');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = { ok: true, status: 204, json: vi.fn(), clone: () => res };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn().mockResolvedValue(res);
    const body = await api.get('/auth/logout');
    expect(body).toBeUndefined();
  });
});

describe('api — 401 path-dependent handling', () => {
  it('401 on /me (when on /user): clears profile + redirects to /?expired=1', async () => {
    const { assign } = setLocation('/user');
    mockFetchResponse(401, { error: 'unauthenticated' });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(setProfileMock).toHaveBeenCalledWith(null);
    expect(assign).toHaveBeenCalledWith('/?expired=1');
    // 401 path skips the toast (banner handles messaging globally).
    expect(pushToastMock).not.toHaveBeenCalled();
  });

  it('401 on /admin/me: passes through, does NOT clear profile or redirect', async () => {
    const { assign } = setLocation('/admin');
    mockFetchResponse(401, { error: 'admin_unauthenticated' });
    await expect(api.get('/admin/me')).rejects.toBeInstanceOf(ApiError);
    expect(setProfileMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('401 when already on /: clears profile but does NOT redirect (avoid loop)', async () => {
    const { assign } = setLocation('/');
    mockFetchResponse(401, { error: 'unauthenticated' });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(setProfileMock).toHaveBeenCalledWith(null);
    expect(assign).not.toHaveBeenCalled();
  });

  it('401 when on /memory: clears profile but does NOT redirect (public projector)', async () => {
    const { assign } = setLocation('/memory');
    mockFetchResponse(401, { error: 'unauthenticated' });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('401 when on /admin (admin route, non-/admin/* API call): does NOT redirect', async () => {
    const { assign } = setLocation('/admin');
    mockFetchResponse(401, { error: 'unauthenticated' });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('401 when on /admin/foo: does NOT redirect', async () => {
    const { assign } = setLocation('/admin/players');
    mockFetchResponse(401, { error: 'unauthenticated' });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('api — non-401 error mapping', () => {
  it('pushes toast on 403, throws ApiError carrying code', async () => {
    setLocation('/user');
    mockFetchResponse(403, { error: 'forbidden_code' });
    try {
      await api.get('/something');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(403);
        expect(err.code).toBe('forbidden_code');
      }
    }
    expect(pushToastMock).toHaveBeenCalledWith('403-forbidden_code');
  });

  it('pushes toast on 500', async () => {
    setLocation('/user');
    mockFetchResponse(500, { error: 'server_boom' });
    await expect(api.get('/something')).rejects.toBeInstanceOf(ApiError);
    expect(pushToastMock).toHaveBeenCalledWith('500-server_boom');
  });

  it('pushes toast + rethrows on network error (fetch rejects)', async () => {
    setLocation('/user');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(api.get('/something')).rejects.toThrow('offline');
    expect(pushToastMock).toHaveBeenCalledTimes(1);
    expect(pushToastMock.mock.calls[0][0]).toMatch(/server/i);
  });

  it('handles non-JSON error body gracefully (no code, body=null)', async () => {
    setLocation('/user');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = {
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error('not json')),
      clone: () => res,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn().mockResolvedValue(res);
    try {
      await api.get('/x');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      if (err instanceof ApiError) {
        expect(err.status).toBe(502);
        expect(err.code).toBeUndefined();
        expect(err.body).toBeNull();
      }
    }
  });
});

describe('api.post / patch / postForm — request shaping', () => {
  it('post sends JSON Content-Type + serialized body', async () => {
    setLocation('/user');
    mockFetchResponse(200, {});
    await api.post('/scans', { scanner_id: 'A', scanned_id: 'B' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"scanner_id":"A","scanned_id":"B"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('postForm omits Content-Type (lets FormData set its own boundary)', async () => {
    setLocation('/user');
    mockFetchResponse(200, {});
    const form = new FormData();
    form.append('photo', new Blob(['x'], { type: 'image/jpeg' }), 'p.jpg');
    await api.postForm('/penalty/p1/confirm', form);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = (globalThis as any).fetch as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
