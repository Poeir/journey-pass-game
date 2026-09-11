// Smoke test for the `requireAdmin` preHandler gate that adminRoutes
// applies to every endpoint on its plugin instance. The gate is uniform
// (Fastify hook semantics) so sampling representative routes per HTTP method
// is sufficient — testing all ~44 admin routes would be redundant noise.
//
// Mocked: every external dependency adminRoutes imports. We never reach a
// handler (the gate fires first), so the mocks are inert.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/lib/employeeCache.js', () => ({
  getEmployee: vi.fn(),
  getEmployeesByIds: vi.fn(),
  invalidateEmployeeCache: vi.fn(),
}));
vi.mock('@/lib/triviaCardCache.js', () => ({
  deriveCardIndex: vi.fn(),
  getTriviaCard: vi.fn(),
  invalidateTriviaCardCache: vi.fn(),
}));
vi.mock('@/domain/scan.js', async () => {
  const actual = await vi.importActual<typeof import('@/domain/scan.js')>('@/domain/scan.js');
  return { ...actual, addTeammateSlotAdmin: vi.fn() };
});
vi.mock('@/lib/cloudinary.js', () => ({ destroyImage: vi.fn() }));
vi.mock('@/lib/ttlCache.js', () => ({ invalidate: vi.fn(), ttlCached: vi.fn() }));
vi.mock('@/lib/gameClock.js', () => ({
  gameEndAt: () => new Date('2026-05-11T17:00:00+07:00'),
  isGameEnded: () => false,
  gameNow: () => new Date('2026-05-11T10:00:00.000Z'),
}));
vi.mock('@/lib/penaltyCache.js', () => ({
  pickRandomPenaltyId: vi.fn(),
  invalidatePenaltyCache: vi.fn(),
}));
vi.mock('@/lib/photoPlaceCache.js', () => ({ invalidatePhotoPlaceCache: vi.fn() }));
vi.mock('@/domain/chatQuestions.js', () => ({
  invalidateChatQuestionCache: vi.fn(),
  pickQuestionForPair: vi.fn(),
}));
vi.mock('@/ws/hub.js', () => ({
  broadcast: vi.fn(),
  broadcastGameEnded: vi.fn(),
  broadcastToUser: vi.fn(),
}));

const { buildTestApp, loginAs } = await import('@/test-utils/buildTestApp.js');
const { adminRoutes } = await import('./admin.js');

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeEach(async () => {
  app = await buildTestApp({
    register: async (a) => {
      await a.register(adminRoutes);
    },
  });
});

// Representative routes sampled across HTTP methods + section groups.
// `requireAdmin` is a single plugin-scoped preHandler hook, so if it gates
// any of these it gates all of them.
//
// Note: Fastify's lifecycle runs body validation BEFORE preHandler. Routes
// with required-field body schemas (POST /admin/employees, POST /admin/trivia,
// PATCH /admin/employees/:id, etc.) reply 400 before the gate fires when no
// body is supplied — that's still "rejected without admin access", but it's
// not the gate's doing. So we sample mutating routes that have either no
// body or accept an empty body. The remaining mutating routes inherit the
// same gate by plugin scope.
const ROUTES: ReadonlyArray<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
  { method: 'GET', url: '/admin/dashboard' },
  { method: 'GET', url: '/admin/players' },
  { method: 'GET', url: '/admin/players/E001' },
  { method: 'POST', url: '/admin/players/E001/complete' },
  { method: 'DELETE', url: '/admin/players/E001/complete' },
  { method: 'GET', url: '/admin/employees' },
  { method: 'DELETE', url: '/admin/employees/E001' },
  { method: 'GET', url: '/admin/trivia' },
  { method: 'GET', url: '/admin/scans' },
  { method: 'GET', url: '/admin/game' },
  { method: 'POST', url: '/admin/game/end-now' },
];

describe('routes/admin — requireAdmin gate (preHandler)', () => {
  it.each(ROUTES)('blocks $method $url with 401 when no session cookie is sent', async ({ method, url }) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'admin_unauthenticated' });
  });

  it.each(ROUTES.slice(0, 4))(
    'blocks $method $url with 401 when session has employeeId but isAdmin is missing',
    async ({ method, url }) => {
      // Player session ≠ admin session. The same cookie can hold both flags,
      // but `requireAdmin` checks for `isAdmin === true` only.
      const cookie = await loginAs(app, { employeeId: 'E001' });
      const res = await app.inject({ method, url, headers: { cookie } });
      expect(res.statusCode).toBe(401);
    },
  );

  it.each(ROUTES.slice(0, 4))(
    'blocks $method $url with 401 when isAdmin is explicitly false',
    async ({ method, url }) => {
      const cookie = await loginAs(app, { employeeId: 'E001', isAdmin: false });
      const res = await app.inject({ method, url, headers: { cookie } });
      expect(res.statusCode).toBe(401);
    },
  );
});

describe('routes/admin — gate passes when isAdmin=true (handler reached)', () => {
  it('passes the gate for GET /admin/dashboard when isAdmin=true (handler then fails downstream — expected)', async () => {
    const cookie = await loginAs(app, { isAdmin: true });
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { cookie } });
    // The handler will explode trying to call mocked prisma (we didn't
    // populate query mocks), so we expect a 500 — but critically NOT 401.
    // This proves the gate let the request through and the failure happens
    // BEYOND the gate, which is the contract we care about.
    expect(res.statusCode).not.toBe(401);
  });
});
