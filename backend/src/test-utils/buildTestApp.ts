import Fastify, { type FastifyInstance } from 'fastify';
import secureSession from '@fastify/secure-session';
import multipart from '@fastify/multipart';

// Deterministic 32-byte key for tests. Real prod uses SESSION_SECRET (64 hex
// chars). Buffer.alloc fills with 0x01 — safe because tests never persist
// these cookies past the inject response.
const SESSION_KEY = Buffer.alloc(32, 1);

export interface TestAppOptions {
  /** Register the route(s) under test on this instance. */
  register: (app: FastifyInstance) => Promise<void> | void;
  /** Set true when testing routes that consume multipart/form-data. */
  multipart?: boolean;
}

/**
 * Minimal Fastify app for integration testing via `app.inject()`:
 * - Real `@fastify/secure-session` (cookie encryption matches prod).
 * - Test-only `POST /__test/login` that writes employeeId / isAdmin onto the
 *   session. Use `loginAs(...)` to get a `Cookie` header back.
 * - Caller registers the route(s) under test inside `options.register`.
 */
export async function buildTestApp(options: TestAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(secureSession, {
    cookieName: 'jp_sess',
    key: SESSION_KEY,
    cookie: { path: '/', httpOnly: true, sameSite: 'lax' },
  });
  if (options.multipart) {
    await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  }
  // Test-only helper. Fields are written individually so a caller can set
  // just isAdmin (admin-only tests) without giving the session a player id.
  app.post<{ Body: { employeeId?: string; isAdmin?: boolean } }>(
    '/__test/login',
    async (req, reply) => {
      const body = req.body ?? {};
      if (body.employeeId !== undefined) req.session.set('employeeId', body.employeeId);
      if (body.isAdmin !== undefined) req.session.set('isAdmin', body.isAdmin);
      return reply.code(204).send();
    },
  );
  await options.register(app);
  await app.ready();
  return app;
}

/**
 * Calls the test-login route, returns the bare `name=value` cookie pair
 * suitable for the `cookie` header on subsequent `inject` calls.
 */
export async function loginAs(
  app: FastifyInstance,
  body: { employeeId?: string; isAdmin?: boolean },
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/__test/login',
    payload: body,
  });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('test login did not return a Set-Cookie header');
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr.split(';')[0];
}
