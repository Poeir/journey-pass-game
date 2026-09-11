import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp } from '@/test-utils/buildTestApp.js';
import { adminAuthRoutes } from './adminAuth.js';

// `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set by vitest.config.ts test.env:
// username='admin', password='admin-pw-12345'.

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  app = await buildTestApp({
    register: async (a) => {
      await a.register(adminAuthRoutes);
    },
  });
});

describe('POST /admin/auth/login', () => {
  it('200 + flips session.isAdmin=true on correct creds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'admin-pw-12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });

    // Verify isAdmin sticks for subsequent requests on the same cookie.
    const cookie = (res.headers['set-cookie'] as string).split(';')[0];
    const me = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      headers: { cookie },
    });
    expect(me.json()).toMatchObject({ isAdmin: true });
  });

  it('401 invalid_credentials on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'wrong-password-1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid_credentials' });
  });

  it('401 on wrong username (same length as real username)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'wrong', password: 'admin-pw-12345' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when username length is shorter than real (safeEqual handles unequal lengths)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'a', password: 'admin-pw-12345' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 when password length is longer than real (safeEqual handles unequal lengths)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'admin-pw-12345-extra-tail' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /admin/auth/logout', () => {
  it('204 + clears isAdmin flag for subsequent /admin/auth/me', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'admin-pw-12345' },
    });
    const cookie1 = (loginRes.headers['set-cookie'] as string).split(';')[0];

    const out = await app.inject({
      method: 'POST',
      url: '/admin/auth/logout',
      headers: { cookie: cookie1 },
    });
    expect(out.statusCode).toBe(204);
    const cookie2 = ((out.headers['set-cookie'] as string) ?? cookie1).split(';')[0];

    const me = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      headers: { cookie: cookie2 },
    });
    expect(me.json()).toMatchObject({ isAdmin: false });
  });
});

describe('GET /admin/auth/me', () => {
  it('returns isAdmin=false for an anonymous request (no cookie)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/auth/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isAdmin: false });
  });

  it('returns isAdmin=true after a successful login', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/admin/auth/login',
      payload: { username: 'admin', password: 'admin-pw-12345' },
    });
    const cookie = (loginRes.headers['set-cookie'] as string).split(';')[0];
    const me = await app.inject({ method: 'GET', url: '/admin/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ isAdmin: true });
  });
});
