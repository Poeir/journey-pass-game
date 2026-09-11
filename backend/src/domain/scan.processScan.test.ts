import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deterministicPairId } from './pairId.js';

// =====================================================================
// Hoisted mocks — built once per file, reset per test via mockReset.
// All Prisma methods used by processScan + addTeammateSlot are stubbed.
// $transaction passes `prismaMock` itself as `tx`, so the same surface
// covers both bare and transactional calls.
// =====================================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = any;

const m = vi.hoisted(() => {
  // Loose typing: this is a test mock, not a Prisma surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prismaMock: any = {
    playerProgress: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scan: { create: vi.fn() },
    triviaStamp: { upsert: vi.fn() },
    pair: { upsert: vi.fn(), findUnique: vi.fn() },
    triviaPenalty: { upsert: vi.fn() },
    teammateSlot: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $executeRaw: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prismaMock.$transaction = vi.fn(async (cb: any) => cb(prismaMock));
  return {
    prisma: prismaMock as AnyMock,
    getEmployeesByIds: vi.fn(),
    getTriviaCard: vi.fn(),
    pickRandomPenaltyId: vi.fn(),
    broadcastToUser: vi.fn(),
    isGameEnded: vi.fn(() => false),
  };
});

vi.mock('@/db/prisma.js', () => ({ prisma: m.prisma }));
vi.mock('@/lib/employeeCache.js', () => ({ getEmployeesByIds: m.getEmployeesByIds }));
vi.mock('@/lib/triviaCardCache.js', () => ({ getTriviaCard: m.getTriviaCard }));
vi.mock('@/lib/penaltyCache.js', () => ({ pickRandomPenaltyId: m.pickRandomPenaltyId }));
vi.mock('@/ws/hub.js', () => ({ broadcastToUser: m.broadcastToUser }));
vi.mock('@/lib/gameClock.js', () => ({ isGameEnded: m.isGameEnded, gameNow: () => new Date('2026-05-11T03:00:00.000Z') }));

const {
  processScan,
  addTeammateSlot,
  addTeammateSlotAdmin,
  NotFoundError,
  GameEndedError,
} = await import('./scan.js');

// =====================================================================
// Fixtures
// =====================================================================
type Emp = {
  id: string;
  name: string;
  initial: string;
  dept: string;
  year: number;
  isLeader: boolean;
  photoUrl: string | null;
};

const emp = (overrides: Partial<Emp> & { id: string }): Emp => {
  const name = overrides.name ?? `Name-${overrides.id}`;
  return {
    name,
    initial: name.charAt(0),
    dept: 'ENG',
    year: 2024,
    isLeader: false,
    photoUrl: null,
    ...overrides,
  };
};

const SCANNER = emp({ id: 'S001', year: 2024 });
const TARGET = emp({ id: 'T001', year: 2024 });
const LEADER = emp({ id: 'L001', isLeader: true, year: 2020 });

beforeEach(() => {
  vi.clearAllMocks();
  m.isGameEnded.mockReturnValue(false);
  // Default: $transaction passes prismaMock as tx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (m.prisma.$transaction as any).mockImplementation(async (cb: any) => cb(m.prisma));
});

// =====================================================================
// Game-ended short-circuit
// =====================================================================
describe('processScan — game ended', () => {
  it('throws GameEndedError before any DB / cache call', async () => {
    m.isGameEnded.mockReturnValueOnce(true);
    await expect(
      processScan({ scannerId: SCANNER.id, scannedId: TARGET.id }),
    ).rejects.toBeInstanceOf(GameEndedError);
    expect(m.getEmployeesByIds).not.toHaveBeenCalled();
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });
});

// =====================================================================
// NotFoundError paths
// =====================================================================
describe('processScan — not found', () => {
  it('throws NotFoundError("target") when target id missing from cache', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER]); // target missing
    await expect(
      processScan({ scannerId: SCANNER.id, scannedId: 'GHOST' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError("scanner") when scanner id missing from cache', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([TARGET]); // scanner missing
    await expect(
      processScan({ scannerId: 'GHOST', scannedId: TARGET.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError("card") when cardRef does not resolve', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, TARGET]);
    m.getTriviaCard.mockResolvedValueOnce(null);
    await expect(
      processScan({ scannerId: SCANNER.id, scannedId: TARGET.id, cardRef: 'CARD-X' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// =====================================================================
// Trivia — match
// =====================================================================
describe('processScan — trivia MATCH', () => {
  it('returns match + writes stamp + broadcasts trivia.found to TARGET', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, TARGET]);
    m.getTriviaCard.mockResolvedValueOnce({
      id: 'C1',
      clue: 'find someone',
      targetIds: [TARGET.id, 'OTHER'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.scan.create as any).mockResolvedValue({ id: 'scan-1' });

    const result = await processScan({
      scannerId: SCANNER.id,
      scannedId: TARGET.id,
      cardRef: 'C1',
    });

    expect(result.outcome).toBe('match');
    if (result.outcome === 'match') {
      expect(result.card_ref).toBe('C1');
      expect(result.stamp.id).toBe('scan-1');
      expect(result.stamp.target.id).toBe(TARGET.id);
    }

    // Side effects inside the transaction
    expect(m.prisma.scan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'TRIVIA',
          outcome: 'MATCH',
          cardRef: 'C1',
          scannerId: SCANNER.id,
          scannedId: TARGET.id,
        }),
      }),
    );
    expect(m.prisma.triviaStamp.upsert).toHaveBeenCalled();
    expect(m.prisma.playerProgress.upsert).toHaveBeenCalled(); // ensurePlayerProgress
    expect(m.prisma.playerProgress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playerId: SCANNER.id },
        data: expect.objectContaining({ updatedAt: expect.any(Date) }),
      }),
    );

    // Broadcast `trivia.found` goes to the SCANNED side (target), carrying the clue
    expect(m.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(m.broadcastToUser).toHaveBeenCalledWith(
      TARGET.id,
      expect.objectContaining({
        type: 'trivia.found',
        cardId: 'C1',
        cardClue: 'find someone',
        counterpartId: SCANNER.id,
      }),
    );
  });
});

// =====================================================================
// Trivia — mismatch (4 sub-cases for "new round" decision)
// =====================================================================
describe('processScan — trivia MISMATCH', () => {
  const otherCard = { id: 'C1', clue: 'x', targetIds: ['NOT-THE-TARGET'] };

  beforeEach(() => {
    m.getEmployeesByIds.mockResolvedValue([SCANNER, TARGET]);
    m.getTriviaCard.mockResolvedValue(otherCard);
    m.pickRandomPenaltyId.mockResolvedValue('PEN-1');
  });

  it('new round when no existing pair: creates pair + penalty + scan, broadcasts both sides', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.pair.findUnique as any).mockResolvedValueOnce(null);

    const result = await processScan({
      scannerId: SCANNER.id,
      scannedId: TARGET.id,
      cardRef: 'C1',
    });

    expect(result.outcome).toBe('mismatch');
    const expectedPairId = deterministicPairId(
      SCANNER.id,
      TARGET.id,
      'TRIVIA',
      '2026-05-11',
    );
    if (result.outcome === 'mismatch') {
      expect(result.pair_id).toBe(expectedPairId);
    }

    expect(m.prisma.pair.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expectedPairId },
        update: { hunterId: SCANNER.id, targetId: TARGET.id },
        create: expect.objectContaining({
          id: expectedPairId,
          kind: 'TRIVIA',
          hunterId: SCANNER.id,
          targetId: TARGET.id,
        }),
      }),
    );
    expect(m.prisma.triviaPenalty.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pairId: expectedPairId },
        create: expect.objectContaining({
          pairId: expectedPairId,
          penaltyId: 'PEN-1',
          targetConfirmed: false,
          proofPhotoUrl: null,
        }),
      }),
    );
    expect(m.prisma.scan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'TRIVIA',
          outcome: 'MISMATCH',
          pairId: expectedPairId,
        }),
      }),
    );

    // Two broadcasts: hunter + target
    expect(m.broadcastToUser).toHaveBeenCalledTimes(2);
    const calls = m.broadcastToUser.mock.calls;
    expect(calls.find((c) => c[0] === SCANNER.id)?.[1]).toMatchObject({
      type: 'pair.created',
      pairId: expectedPairId,
      mode: 'trivia',
      role: 'hunter',
    });
    expect(calls.find((c) => c[0] === TARGET.id)?.[1]).toMatchObject({
      type: 'pair.created',
      pairId: expectedPairId,
      mode: 'trivia',
      role: 'target',
    });
  });

  it('new round when prior round was confirmed (targetConfirmed=true): rolls penalty again', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.pair.findUnique as any).mockResolvedValueOnce({
      id: 'old',
      hunterId: SCANNER.id,
      targetId: TARGET.id,
      kind: 'TRIVIA',
      triviaPenalty: { targetConfirmed: true, proofPhotoUrl: 'x', penaltyId: 'OLD' },
    });

    await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id, cardRef: 'C1' });

    expect(m.prisma.triviaPenalty.upsert).toHaveBeenCalled();
    // pair.upsert.update IS populated (new round)
    expect(m.prisma.pair.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { hunterId: SCANNER.id, targetId: TARGET.id },
      }),
    );
  });

  it('new round when scan direction flipped (existing.hunterId !== scannerId): hunter/target swap', async () => {
    // Earlier today, target scanned scanner; now scanner scans target back.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.pair.findUnique as any).mockResolvedValueOnce({
      id: 'old',
      hunterId: TARGET.id, // OTHER party was the hunter before
      targetId: SCANNER.id,
      kind: 'TRIVIA',
      triviaPenalty: { targetConfirmed: false, proofPhotoUrl: null, penaltyId: 'OLD' },
    });

    await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id, cardRef: 'C1' });

    expect(m.prisma.pair.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { hunterId: SCANNER.id, targetId: TARGET.id },
      }),
    );
    // Penalty rolled fresh
    expect(m.prisma.triviaPenalty.upsert).toHaveBeenCalled();
  });

  it('SAME round re-scan: NO penalty roll, NO hunter swap, BUT broadcast STILL fires (re-deliver)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.pair.findUnique as any).mockResolvedValueOnce({
      id: 'old',
      hunterId: SCANNER.id, // same hunter
      targetId: TARGET.id,
      kind: 'TRIVIA',
      triviaPenalty: { targetConfirmed: false, proofPhotoUrl: null, penaltyId: 'OLD' },
    });

    await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id, cardRef: 'C1' });

    // newRound = false → pair.upsert.update is the empty {} branch
    expect(m.prisma.pair.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
    // No penalty roll on same-round re-scan
    expect(m.prisma.triviaPenalty.upsert).not.toHaveBeenCalled();
    // ⚠️ CRITICAL: broadcast STILL fires (CLAUDE.md says re-fire so target who missed it gets pulled in)
    expect(m.broadcastToUser).toHaveBeenCalledTimes(2);
  });
});

// =====================================================================
// Teammate — wrong_year
// =====================================================================
describe('processScan — wrong_year', () => {
  it('non-leader vs non-leader, both 2023+, different year → MISMATCH row (no pairId), no broadcast', async () => {
    const s = emp({ id: 'S001', year: 2023 });
    const t = emp({ id: 'T001', year: 2024 });
    m.getEmployeesByIds.mockResolvedValueOnce([s, t]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: s.id,
      assignedLeaderId: null,
      teammateSlots: [],
    });

    const result = await processScan({ scannerId: s.id, scannedId: t.id });

    expect(result.outcome).toBe('wrong_year');
    expect(m.prisma.scan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'TEAMMATE',
          outcome: 'MISMATCH',
          scannerId: s.id,
          scannedId: t.id,
        }),
      }),
    );
    // No pairId on wrong_year scan row
    const call = m.prisma.scan.create.mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((call as any).data.pairId).toBeUndefined();
    expect(m.broadcastToUser).not.toHaveBeenCalled();
  });

  it('boundary: scanner.year=2022 + target.year=2021 (both seniors) → outcome=chat, not wrong_year', async () => {
    const s = emp({ id: 'S001', year: 2022 });
    const t = emp({ id: 'T001', year: 2021 });
    m.getEmployeesByIds.mockResolvedValueOnce([s, t]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: s.id,
      assignedLeaderId: null,
      teammateSlots: [],
    });

    const result = await processScan({ scannerId: s.id, scannedId: t.id });
    expect(result.outcome).toBe('chat');
  });
});

// =====================================================================
// Teammate — wrong_leader / leader_clash
// =====================================================================
describe('processScan — leader checks', () => {
  it('wrong_leader: non-leader scanner, assignedLeaderId set, target is a DIFFERENT leader → no audit row, no broadcast', async () => {
    const targetLeader = emp({ id: 'WRONG-LEADER', isLeader: true });
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, targetLeader]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: SCANNER.id,
      assignedLeaderId: 'CORRECT-LEADER',
      teammateSlots: [],
    });

    const result = await processScan({ scannerId: SCANNER.id, scannedId: targetLeader.id });
    expect(result.outcome).toBe('wrong_leader');
    expect(m.prisma.scan.create).not.toHaveBeenCalled();
    expect(m.broadcastToUser).not.toHaveBeenCalled();
  });

  it('leader_clash: scanner is a leader scanning another leader → no audit row, no broadcast', async () => {
    const scannerLeader = emp({ id: 'S-LEAD', isLeader: true });
    const targetLeader = emp({ id: 'T-LEAD', isLeader: true });
    m.getEmployeesByIds.mockResolvedValueOnce([scannerLeader, targetLeader]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: scannerLeader.id,
      assignedLeaderId: null,
      teammateSlots: [],
    });

    const result = await processScan({
      scannerId: scannerLeader.id,
      scannedId: targetLeader.id,
    });
    expect(result.outcome).toBe('leader_clash');
    expect(m.prisma.scan.create).not.toHaveBeenCalled();
    expect(m.broadcastToUser).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Teammate — already_added / leader_full / teammate_full
// =====================================================================
describe('processScan — slot guard rails', () => {
  it('already_added: scanned id is already in teammateSlots → no audit row', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, TARGET]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: SCANNER.id,
      assignedLeaderId: null,
      teammateSlots: [{ memberId: TARGET.id, member: { isLeader: false } }],
    });

    const result = await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id });
    expect(result.outcome).toBe('already_added');
    expect(m.prisma.scan.create).not.toHaveBeenCalled();
    expect(m.broadcastToUser).not.toHaveBeenCalled();
  });

  it('leader_full: target is a leader and scanner already has a different leader in slots', async () => {
    const newLeader = emp({ id: 'NEW-LEAD', isLeader: true });
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, newLeader]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: SCANNER.id,
      assignedLeaderId: newLeader.id, // assigned-leader matches so we get past wrong_leader
      teammateSlots: [{ memberId: 'EXISTING-LEAD', member: { isLeader: true } }],
    });

    const result = await processScan({ scannerId: SCANNER.id, scannedId: newLeader.id });
    expect(result.outcome).toBe('leader_full');
    expect(m.prisma.scan.create).not.toHaveBeenCalled();
  });

  it('teammate_full: 5 non-leaders already + add another non-leader → blocked, no audit row', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, TARGET]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: SCANNER.id,
      assignedLeaderId: null,
      teammateSlots: [1, 2, 3, 4, 5].map((i) => ({
        memberId: `M${i}`,
        member: { isLeader: false },
      })),
    });

    const result = await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id });
    expect(result.outcome).toBe('teammate_full');
    expect(m.prisma.scan.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Teammate — chat (happy path)
// =====================================================================
describe('processScan — chat', () => {
  it('chat (non-leader): creates teammate Pair + MATCH scan + broadcasts to TARGET only; does NOT add slot', async () => {
    m.getEmployeesByIds.mockResolvedValueOnce([SCANNER, TARGET]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: SCANNER.id,
      assignedLeaderId: null,
      teammateSlots: [],
    });

    const result = await processScan({ scannerId: SCANNER.id, scannedId: TARGET.id });

    const expectedPairId = deterministicPairId(
      SCANNER.id,
      TARGET.id,
      'TEAMMATE',
      '2026-05-11',
    );
    expect(result.outcome).toBe('chat');
    if (result.outcome === 'chat') expect(result.pair_id).toBe(expectedPairId);

    expect(m.prisma.pair.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expectedPairId },
        create: expect.objectContaining({
          id: expectedPairId,
          kind: 'TEAMMATE',
          hunterId: SCANNER.id,
          targetId: TARGET.id,
        }),
      }),
    );
    expect(m.prisma.scan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'TEAMMATE',
          outcome: 'MATCH',
          pairId: expectedPairId,
        }),
      }),
    );
    // Slot writes are deferred to /chat/:pairId/confirm-teammate
    expect(m.prisma.teammateSlot.create).not.toHaveBeenCalled();

    // ONE broadcast — to TARGET only (scanner state set client-side by ScannerPage)
    expect(m.broadcastToUser).toHaveBeenCalledTimes(1);
    expect(m.broadcastToUser).toHaveBeenCalledWith(
      TARGET.id,
      expect.objectContaining({
        type: 'pair.created',
        pairId: expectedPairId,
        mode: 'teammate',
        role: 'target',
      }),
    );
  });

  it('chat for LEADER target: year check is bypassed (leader can be from any cohort)', async () => {
    const seniorScanner = emp({ id: 'S-NEW', year: 2024 });
    const leaderFromAnyYear = emp({ id: 'L-OLD', year: 2019, isLeader: true });
    m.getEmployeesByIds.mockResolvedValueOnce([seniorScanner, leaderFromAnyYear]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.playerProgress.findUnique as any).mockResolvedValueOnce({
      playerId: seniorScanner.id,
      assignedLeaderId: leaderFromAnyYear.id,
      teammateSlots: [],
    });

    const result = await processScan({
      scannerId: seniorScanner.id,
      scannedId: leaderFromAnyYear.id,
    });
    expect(result.outcome).toBe('chat');
  });
});

// =====================================================================
// addTeammateSlot — cap + dedup + advisory lock
// =====================================================================
describe('addTeammateSlot — cap enforcement', () => {
  const player = SCANNER.id;
  const newMember = { ...TARGET, initial: 'T' };

  function setSlots(rows: { memberId: string; isLeader: boolean }[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findMany as any).mockResolvedValue(
      rows.map((r) => ({
        playerId: player,
        memberId: r.memberId,
        member: { isLeader: r.isLeader },
      })),
    );
  }

  it('add new non-leader to empty roster → row created, return true, updatedAt bumped', async () => {
    setSlots([]);
    const added = await addTeammateSlot(player, newMember);
    expect(added).toBe(true);
    expect(m.prisma.teammateSlot.create).toHaveBeenCalledWith({
      data: { playerId: player, memberId: newMember.id },
    });
    expect(m.prisma.playerProgress.update).toHaveBeenCalled();
  });

  it('duplicate id → no-op, return false, no insert', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValue({
      playerId: player,
      memberId: newMember.id,
    });
    const added = await addTeammateSlot(player, newMember);
    expect(added).toBe(false);
    expect(m.prisma.teammateSlot.create).not.toHaveBeenCalled();
    expect(m.prisma.playerProgress.update).not.toHaveBeenCalled();
  });

  it('5 non-leaders + add LEADER → return true (6 total ok, 5+1 cap)', async () => {
    setSlots([1, 2, 3, 4, 5].map((i) => ({ memberId: `M${i}`, isLeader: false })));
    const leader = { ...newMember, id: 'L', isLeader: true };
    const added = await addTeammateSlot(player, leader);
    expect(added).toBe(true);
    expect(m.prisma.teammateSlot.create).toHaveBeenCalled();
  });

  it('5 non-leaders + add NON-LEADER → return false (cap hit)', async () => {
    setSlots([1, 2, 3, 4, 5].map((i) => ({ memberId: `M${i}`, isLeader: false })));
    const added = await addTeammateSlot(player, newMember);
    expect(added).toBe(false);
    expect(m.prisma.teammateSlot.create).not.toHaveBeenCalled();
  });

  it('has leader already + add another LEADER → return false', async () => {
    setSlots([{ memberId: 'EXISTING-LEAD', isLeader: true }]);
    const leader = { ...newMember, id: 'L2', isLeader: true };
    const added = await addTeammateSlot(player, leader);
    expect(added).toBe(false);
    expect(m.prisma.teammateSlot.create).not.toHaveBeenCalled();
  });

  it('4 non-leaders + 1 leader + add NON-LEADER → return true (fill slot 5)', async () => {
    setSlots([
      { memberId: 'M1', isLeader: false },
      { memberId: 'M2', isLeader: false },
      { memberId: 'M3', isLeader: false },
      { memberId: 'M4', isLeader: false },
      { memberId: 'L', isLeader: true },
    ]);
    const added = await addTeammateSlot(player, newMember);
    expect(added).toBe(true);
  });

  it('always acquires the per-player advisory lock', async () => {
    setSlots([]);
    await addTeammateSlot(player, newMember);
    expect(m.prisma.$executeRaw).toHaveBeenCalled();
  });

  it('updatedAt is bumped only when a row is actually created', async () => {
    // 1) duplicate path → no bump
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValueOnce({
      playerId: player,
      memberId: newMember.id,
    });
    await addTeammateSlot(player, newMember);
    expect(m.prisma.playerProgress.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// addTeammateSlotAdmin — bypasses cap
// =====================================================================
describe('addTeammateSlotAdmin — admin override', () => {
  const player = SCANNER.id;
  const newMember = { ...TARGET };

  it('bypasses 5-cap: 6 non-leaders already → 7th add succeeds', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findMany as any).mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((i) => ({
        memberId: `M${i}`,
        member: { isLeader: false },
      })),
    );
    const added = await addTeammateSlotAdmin(player, newMember);
    expect(added).toBe(true);
    expect(m.prisma.teammateSlot.create).toHaveBeenCalled();
  });

  it('still dedups by id (admin path is not "add even when present")', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValueOnce({
      playerId: player,
      memberId: newMember.id,
    });
    const added = await addTeammateSlotAdmin(player, newMember);
    expect(added).toBe(false);
    expect(m.prisma.teammateSlot.create).not.toHaveBeenCalled();
  });

  it('still acquires the advisory lock', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m.prisma.teammateSlot.findUnique as any).mockResolvedValue(null);
    await addTeammateSlotAdmin(player, newMember);
    expect(m.prisma.$executeRaw).toHaveBeenCalled();
  });
});
