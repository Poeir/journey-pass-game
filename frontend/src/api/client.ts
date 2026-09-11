import { useGame } from '@/game/gameStore';
import { useErrorStore, describeHttpError } from '@/lib/errorStore';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public code?: string,
  ) {
    super(code ? `${status} ${code}` : `${status}`);
    this.name = 'ApiError';
  }
}

function handleUnauthorized(reqPath: string): void {
  if (typeof window === 'undefined') return;
  // Admin endpoints carry their own `isAdmin` gate that's independent from the
  // game session (same `jp_sess` cookie, separate flag). A 401 from /admin/*
  // means "not an admin", not "your game session expired" — AdminShell
  // catches the ApiError and routes to /admin/login itself, so don't blow
  // away the game profile or trigger the global expired banner here.
  if (reqPath.startsWith('/admin/')) return;
  // Always clear the stale profile so the store stays in sync with the server.
  try {
    useGame.getState().setProfile(null);
  } catch {
    // ignore store errors
  }
  // Avoid redirect loop on welcome, and let unauthenticated visitors stay on
  // the public projector pages (memory wall, ranking — no auth required).
  // Also stay put when on the admin portal — admin doesn't require a game
  // session, so a stale /me 401 shouldn't yank the user off /admin.
  const path = window.location.pathname;
  if (path === '/' || path === '/memory' || path === '/ranking') return;
  if (path === '/admin' || path.startsWith('/admin/')) return;
  window.location.assign('/?expired=1');
}

async function req<T>(path: string, init?: RequestInit, form = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: {
        ...(init?.body != null && !form ? { 'Content-Type': 'application/json' } : {}),
        'ngrok-skip-browser-warning': 'true',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    // Network error / CORS failure — fetch rejects without a Response.
    useErrorStore.getState().push("Couldn't reach the server · Please try again");
    throw err;
  }

  if (!res.ok) {
    let body: unknown = null;
    let code: string | undefined;
    try {
      body = await res.clone().json();
      if (
        body &&
        typeof body === 'object' &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'string'
      ) {
        code = (body as { error: string }).error;
      }
    } catch {
      // body isn't JSON; ignore
    }
    if (res.status === 401) {
      // 401 is handled globally via redirect + banner (skip toast to avoid
      // double-messaging). /admin/* is the exception — see handleUnauthorized.
      handleUnauthorized(path);
    } else {
      useErrorStore.getState().push(describeHttpError(res.status, code));
    }
    throw new ApiError(res.status, body, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    req<T>(path, { method: 'PATCH', body: body == null ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => req<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    req<T>(path, { method: 'POST', body: form }, true),
};
