import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaMock: any = {
    pair: { findUnique: vi.fn() },
    triviaPenalty: { upsert: vi.fn() },
    memoryPhoto: { create: vi.fn() },
  };
  return {
    prisma: prismaMock,
    uploadImage: vi.fn(),
    broadcast: vi.fn(),
    broadcastToUser: vi.fn(),
    getEmployeesByIds: vi.fn(),
    pickRandomPenaltyId: vi.fn(),
    invalidate: vi.fn(),
  };
});

vi.mock('@/db/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/cloudinary.js', () => ({ uploadImage: mocks.uploadImage }));
vi.mock('@/ws/hub.js', () => ({
  broadcast: mocks.broadcast,
  broadcastToUser: mocks.broadcastToUser,
}));
vi.mock('@/lib/employeeCache.js', () => ({ getEmployeesByIds: mocks.getEmployeesByIds }));
vi.mock('@/lib/penaltyCache.js', () => ({ pickRandomPenaltyId: mocks.pickRandomPenaltyId }));
vi.mock('@/lib/ttlCache.js', () => ({ invalidate: mocks.invalidate, ttlCached: vi.fn() }));

const { buildTestApp, loginAs } = await import('@/test-utils/buildTestApp.js');
const { penaltyRoutes } = await import('./penalty.js');

const HUNTER = 'H001';
const TARGET = 'T001';
const PAIR_ID = 'pair-abc';

async function setup(employeeId: string) {
  const app = await buildTestApp({
    register: async (a) => {
      await a.register(penaltyRoutes);
    },
    multipart: true,
  });
  const cookie = await loginAs(app, { employeeId });
  return { app, cookie };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// POST /penalty/:pairId/confirm
// =====================================================================
describe('POST /penalty/:pairId/confirm — auth + ownership gates', () => {
  it('401 when no session', async () => {
    const app = await buildTestApp({
      register: async (a) => {
        await a.register(penaltyRoutes);
      },
      multipart: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/penalty/${PAIR_ID}/confirm`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 not_found when pair does not exist', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: `/penalty/${PAIR_ID}/confirm`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('403 not_target when session.employeeId !== pair.targetId', async () => {
    // Hunter trying to confirm — must be blocked.
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/penalty/${PAIR_ID}/confirm`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'not_target' });
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });

  it('400 missing_photo when no file is attached (after passing auth + target check)', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    // No multipart body — req.file() returns null.
    const res = await app.inject({
      method: 'POST',
      url: `/penalty/${PAIR_ID}/confirm`,
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=----TEST' },
      payload: '------TEST--\r\n',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'missing_photo' });
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });
});

// =====================================================================
// GET /penalty/:pairId
// =====================================================================
describe('GET /penalty/:pairId — state read', () => {
  it('401 when no session', async () => {
    const app = await buildTestApp({
      register: async (a) => {
        await a.register(penaltyRoutes);
      },
      multipart: true,
    });
    const res = await app.inject({ method: 'GET', url: `/penalty/${PAIR_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it('404 when pair does not exist', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'GET',
      url: `/penalty/${PAIR_ID}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 returns targetConfirmed=false / proofPhotoUrl=null / penalty=null when triviaPenalty side-row missing', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
      triviaPenalty: null,
    });
    mocks.getEmployeesByIds.mockResolvedValueOnce([
      { id: HUNTER, name: 'H' },
      { id: TARGET, name: 'T' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/penalty/${PAIR_ID}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      targetConfirmed: false,
      proofPhotoUrl: null,
      penalty: null,
      hunter: { id: HUNTER },
      target: { id: TARGET },
    });
  });

  it('200 returns full state when triviaPenalty + penalty are present', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
      triviaPenalty: {
        targetConfirmed: true,
        proofPhotoUrl: 'https://cdn/x.jpg',
        penalty: { id: 'PEN-1', text: 'dance' },
      },
    });
    mocks.getEmployeesByIds.mockResolvedValueOnce([
      { id: HUNTER, name: 'H' },
      { id: TARGET, name: 'T' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/penalty/${PAIR_ID}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      targetConfirmed: true,
      proofPhotoUrl: 'https://cdn/x.jpg',
      penalty: { id: 'PEN-1', text: 'dance' },
    });
  });
});
