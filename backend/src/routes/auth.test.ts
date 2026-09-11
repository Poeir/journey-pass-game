import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks for the dependency surface auth.ts pulls in. We intentionally do NOT
// mock the Azure OIDC pieces — only the `/me*` query routes are under test.
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaMock: any = {
    playerProgress: { findUnique: vi.fn() },
    pair: { findFirst: vi.fn(), findUnique: vi.fn() },
    chatAnswer: { findFirst: vi.fn() },
  };
  return {
    prisma: prismaMock,
    getEmployee: vi.fn(),
    getEmployeesByIds: vi.fn(),
    getCriteriaClues: vi.fn(),
    getTriviaCardsByIds: vi.fn(),
    isGameEnded: vi.fn(() => false),
    gameEndAt: vi.fn(() => new Date('2026-05-11T17:00:00+07:00')),
  };
});

vi.mock('@/db/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/employeeCache.js', () => ({
  getEmployee: mocks.getEmployee,
  getEmployeesByIds: mocks.getEmployeesByIds,
}));
vi.mock('@/lib/triviaCardCache.js', () => ({
  getCriteriaClues: mocks.getCriteriaClues,
  getTriviaCardsByIds: mocks.getTriviaCardsByIds,
}));
vi.mock('@/lib/gameClock.js', () => ({
  isGameEnded: mocks.isGameEnded,
  gameEndAt: mocks.gameEndAt,
  gameNow: () => new Date('2026-05-11T10:00:00.000Z'),
}));
// Azure client is loaded by authRoutes at module import time — stub.
vi.mock('@/lib/azureClient.js', () => ({
  acquireTokenByCode: vi.fn(),
  buildRedirectUri: vi.fn(() => 'http://localhost/cb'),
  generatePkce: vi.fn(),
  getAuthCodeUrl: vi.fn(),
}));

const { buildTestApp, loginAs } = await import('@/test-utils/buildTestApp.js');
const { authRoutes } = await import('./auth.js');

const PLAYER_ID = 'E001';

async function setup(employeeId?: string) {
  const app = await buildTestApp({
    register: async (a) => {
      await a.register(authRoutes);
    },
  });
  const cookie = employeeId ? await loginAs(app, { employeeId }) : '';
  return { app, cookie };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isGameEnded.mockReturnValue(false);
});

const fakeEmployee = {
  id: PLAYER_ID,
  name: 'Alice',
  nickname: 'A',
  position: 'Engineer',
  dept: 'ENG',
  year: 2024,
  email: 'alice@x.co',
  isLeader: false,
  leaderClue: null,
};

// =====================================================================
// GET /me
// =====================================================================
describe('GET /me', () => {
  it('401 when no session cookie', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('200 returns profile shape from employeeCache', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.getEmployee.mockResolvedValueOnce(fakeEmployee);
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: PLAYER_ID,
      name: 'Alice',
      nickname: 'A',
      position: 'Engineer',
      initial: 'A',
      dept: 'ENG',
      year: 2024,
      email: 'alice@x.co',
      isLeader: false,
    });
  });

  it('404 when employeeCache returns null (corrupted session / employee deleted)', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.getEmployee.mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('email falls back to empty string when null', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.getEmployee.mockResolvedValueOnce({ ...fakeEmployee, email: null });
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(res.json().email).toBe('');
  });
});

// =====================================================================
// GET /me/progress
// =====================================================================
describe('GET /me/progress', () => {
  it('401 when no session cookie', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/me/progress' });
    expect(res.statusCode).toBe(401);
  });

  it('200 returns full progress shape from normalized tables + caches', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.prisma.playerProgress.findUnique.mockResolvedValueOnce({
      completedAt: null,
      assignedLeaderId: 'L001',
      assignedCards: [{ cardId: 'C1' }, { cardId: 'C2' }],
      triviaStamps: [{ cardId: 'C1', targetId: 'T1' }],
      teammateSlots: [{ memberId: 'M1' }, { memberId: 'M2' }],
    });
    mocks.getTriviaCardsByIds.mockResolvedValueOnce([
      { id: 'C1', index: 1, clue: 'clue-1' },
      { id: 'C2', index: 2, clue: 'clue-2' },
    ]);
    mocks.getEmployeesByIds
      // first call: stamp targets (deduped)
      .mockResolvedValueOnce([
        { id: 'T1', name: 'Target One', dept: 'X', year: 2024, isLeader: false },
      ])
      // second call: slot members
      .mockResolvedValueOnce([
        { id: 'M1', name: 'Member One', dept: 'X', year: 2024, isLeader: false },
        { id: 'M2', name: 'Member Two', dept: 'X', year: 2024, isLeader: false },
      ]);
    mocks.getEmployee.mockResolvedValueOnce({
      id: 'L001',
      name: 'Leader',
      dept: 'X',
      year: 2018,
      isLeader: true,
      leaderClue: 'eats pizza',
    });

    const res = await app.inject({ method: 'GET', url: '/me/progress', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards).toHaveLength(2);
    expect(body.cards[0]).toMatchObject({ id: 'C1', index: 1, clue: 'clue-1' });
    expect(body.triviaStamps['C1']).toMatchObject({ id: 'T1', name: 'Target One' });
    expect(body.teammateSlots).toHaveLength(2);
    expect(body.teammateSlots[0]).toMatchObject({ id: 'M1' });
    expect(body.completedAt).toBeNull();
    expect(body.gameEndedAt).toBeNull(); // isGameEnded mocked to false
    expect(body.leaderClue).toBe('eats pizza');
  });

  it('gameEndedAt is set when isGameEnded()=true', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.isGameEnded.mockReturnValue(true);
    mocks.prisma.playerProgress.findUnique.mockResolvedValueOnce(null);
    mocks.getTriviaCardsByIds.mockResolvedValueOnce([]);
    mocks.getEmployeesByIds.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/me/progress', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().gameEndedAt).toBeTruthy();
  });

  it('returns empty shape when no PlayerProgress row exists yet (new player)', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.prisma.playerProgress.findUnique.mockResolvedValueOnce(null);
    mocks.getTriviaCardsByIds.mockResolvedValueOnce([]);
    mocks.getEmployeesByIds.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/me/progress', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      cards: [],
      triviaStamps: {},
      teammateSlots: [],
      completedAt: null,
      leaderClue: null,
    });
  });
});

// =====================================================================
// GET /me/pending-penalty
// =====================================================================
describe('GET /me/pending-penalty', () => {
  it('401 when no session cookie', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/me/pending-penalty' });
    expect(res.statusCode).toBe(401);
  });

  it('200 returns null when no pending TRIVIA pair', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.prisma.pair.findFirst.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'GET',
      url: '/me/pending-penalty',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pending: null });
  });

  it('200 returns role=hunter when user is the hunter on the unconfirmed pair', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.prisma.pair.findFirst.mockResolvedValueOnce({
      id: 'pair-1',
      kind: 'TRIVIA',
      hunterId: PLAYER_ID,
      targetId: 'T1',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/pending-penalty',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pending: { pairId: 'pair-1', role: 'hunter' } });
  });

  it('200 returns role=target when user is the target', async () => {
    const { app, cookie } = await setup(PLAYER_ID);
    mocks.prisma.pair.findFirst.mockResolvedValueOnce({
      id: 'pair-2',
      kind: 'TRIVIA',
      hunterId: 'OTHER',
      targetId: PLAYER_ID,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me/pending-penalty',
      headers: { cookie },
    });
    expect(res.json()).toMatchObject({ pending: { pairId: 'pair-2', role: 'target' } });
  });
});
