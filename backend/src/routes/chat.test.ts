import { describe, it, expect, beforeEach, vi } from 'vitest';

// =====================================================================
// Hoisted mocks — Prisma, caches, domain helpers used by chat.ts.
// =====================================================================
const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaMock: any = {
    pair: { findUnique: vi.fn() },
    chatAnswer: { upsert: vi.fn(), findMany: vi.fn() },
    playerProgress: { findUnique: vi.fn() },
  };
  return {
    prisma: prismaMock,
    addTeammateSlot: vi.fn(),
    broadcastToUser: vi.fn(),
    broadcast: vi.fn(),
    getEmployeesByIds: vi.fn(),
    pickQuestionForPair: vi.fn(),
  };
});

vi.mock('@/db/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/employeeCache.js', () => ({
  getEmployeesByIds: mocks.getEmployeesByIds,
}));
vi.mock('@/domain/chatQuestions.js', () => ({
  pickQuestionForPair: mocks.pickQuestionForPair,
}));
vi.mock('@/ws/hub.js', () => ({
  broadcastToUser: mocks.broadcastToUser,
  broadcast: mocks.broadcast,
}));
// Keep `inSameYearGroup`, `toEmployeeShape` real — only stub `addTeammateSlot`.
vi.mock('@/domain/scan.js', async () => {
  const actual = await vi.importActual<typeof import('@/domain/scan.js')>('@/domain/scan.js');
  return { ...actual, addTeammateSlot: mocks.addTeammateSlot };
});

const { buildTestApp, loginAs } = await import('@/test-utils/buildTestApp.js');
const { chatRoutes } = await import('./chat.js');

const HUNTER = 'H001';
const TARGET = 'T001';
const PAIR_ID = 'pair-abc';

const emp = (id: string, overrides: Partial<{ year: number; isLeader: boolean }> = {}) => ({
  id,
  name: `Name-${id}`,
  dept: 'ENG',
  year: 2024,
  isLeader: false,
  ...overrides,
});

async function setup(employeeId: string) {
  const app = await buildTestApp({
    register: async (a) => {
      await a.register(chatRoutes);
    },
  });
  const cookie = await loginAs(app, { employeeId });
  return { app, cookie };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// GET /chat/:pairId/question
// =====================================================================
describe('GET /chat/:pairId/question', () => {
  it('401 when no session', async () => {
    const app = await buildTestApp({
      register: async (a) => {
        await a.register(chatRoutes);
      },
    });
    const res = await app.inject({ method: 'GET', url: `/chat/${PAIR_ID}/question` });
    expect(res.statusCode).toBe(401);
  });

  it('404 not_found when pair missing', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'GET',
      url: `/chat/${PAIR_ID}/question`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 not_teammate_pair when pair.kind=TRIVIA', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/chat/${PAIR_ID}/question`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'not_teammate_pair' });
  });

  it('403 forbidden when session is neither hunter nor target', async () => {
    const { app, cookie } = await setup('OUTSIDER');
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/chat/${PAIR_ID}/question`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('200 returns question + role + counterpart + answered flags', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    mocks.pickQuestionForPair.mockResolvedValueOnce({ id: 'Q1', question: 'what is...' });
    mocks.getEmployeesByIds.mockResolvedValueOnce([emp(TARGET)]);
    mocks.prisma.chatAnswer.findMany.mockResolvedValueOnce([{ answererId: TARGET }]);

    const res = await app.inject({
      method: 'GET',
      url: `/chat/${PAIR_ID}/question`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      question: 'what is...',
      role: 'hunter',
      counterpart: { id: TARGET },
      myAnswered: false,
      theirAnswered: true,
    });
  });
});

// =====================================================================
// POST /chat/:pairId/confirm-teammate
// =====================================================================
describe('POST /chat/:pairId/confirm-teammate', () => {
  beforeEach(() => {
    mocks.pickQuestionForPair.mockResolvedValue({ id: 'Q1', question: 'qq' });
  });

  it('401 when no session', async () => {
    const app = await buildTestApp({
      register: async (a) => {
        await a.register(chatRoutes);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      payload: { answer: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404 not_found when pair missing', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 not_teammate_pair when kind=TRIVIA', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TRIVIA',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('403 forbidden when session is neither hunter nor target', async () => {
    const { app, cookie } = await setup('OUTSIDER');
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 missing_answer when body.answer is whitespace only', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'missing_answer' });
  });

  it('200 first submitter: bothAnswered=false, added=false, NO addTeammateSlot, NO broadcast', async () => {
    const { app, cookie } = await setup(HUNTER);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    mocks.getEmployeesByIds.mockResolvedValueOnce([emp(HUNTER), emp(TARGET)]);
    // After upsert, findMany returns only the hunter's answer (target hasn't submitted).
    mocks.prisma.chatAnswer.findMany.mockResolvedValueOnce([{ answererId: HUNTER }]);

    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'my answer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      bothAnswered: false,
      added: false,
      role: 'hunter',
      counterpart: { id: TARGET },
    });
    expect(mocks.prisma.chatAnswer.upsert).toHaveBeenCalled();
    expect(mocks.addTeammateSlot).not.toHaveBeenCalled();
    expect(mocks.broadcastToUser).not.toHaveBeenCalled();
  });

  it('200 second submitter: bothAnswered=true → adds slot for BOTH sides + broadcasts to other side', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    mocks.getEmployeesByIds.mockResolvedValueOnce([emp(HUNTER), emp(TARGET)]);
    // Both answer rows present → bothAnswered=true
    mocks.prisma.chatAnswer.findMany.mockResolvedValueOnce([
      { answererId: HUNTER },
      { answererId: TARGET },
    ]);
    mocks.prisma.playerProgress.findUnique
      .mockResolvedValueOnce({ assignedLeaderId: null }) // caller (target)
      .mockResolvedValueOnce({ assignedLeaderId: null }); // other (hunter)
    mocks.addTeammateSlot.mockResolvedValue(true);

    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'my answer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      bothAnswered: true,
      added: true,
    });
    // Slot added for BOTH sides (mutual-add)
    expect(mocks.addTeammateSlot).toHaveBeenCalledTimes(2);
    const callerArgs = mocks.addTeammateSlot.mock.calls.find((c) => c[0] === TARGET);
    const otherArgs = mocks.addTeammateSlot.mock.calls.find((c) => c[0] === HUNTER);
    expect(callerArgs).toBeDefined();
    expect(otherArgs).toBeDefined();
    // Broadcast goes to the OTHER side (the one currently waiting on their phone)
    expect(mocks.broadcastToUser).toHaveBeenCalledWith(
      HUNTER,
      expect.objectContaining({
        type: 'chat.both_answered',
        pairId: PAIR_ID,
        counterpartId: TARGET,
      }),
    );
  });

  it('200 cross-cohort: mutual-add silently skips when year mismatch (non-leader both 2023+ with diff years)', async () => {
    const { app, cookie } = await setup(TARGET);
    mocks.prisma.pair.findUnique.mockResolvedValueOnce({
      id: PAIR_ID,
      kind: 'TEAMMATE',
      hunterId: HUNTER,
      targetId: TARGET,
    });
    // Force a cross-cohort scan: target 2023, hunter 2024 — both >= cutoff, different years.
    mocks.getEmployeesByIds.mockResolvedValueOnce([
      emp(HUNTER, { year: 2024 }),
      emp(TARGET, { year: 2023 }),
    ]);
    mocks.prisma.chatAnswer.findMany.mockResolvedValueOnce([
      { answererId: HUNTER },
      { answererId: TARGET },
    ]);
    mocks.prisma.playerProgress.findUnique
      .mockResolvedValueOnce({ assignedLeaderId: null })
      .mockResolvedValueOnce({ assignedLeaderId: null });

    const res = await app.inject({
      method: 'POST',
      url: `/chat/${PAIR_ID}/confirm-teammate`,
      headers: { cookie },
      payload: { answer: 'my answer' },
    });
    expect(res.statusCode).toBe(200);
    // Both year-checks fail → no slot added for either side
    expect(mocks.addTeammateSlot).not.toHaveBeenCalled();
  });
});
