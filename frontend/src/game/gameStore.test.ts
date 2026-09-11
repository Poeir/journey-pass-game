import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGame,
  formatYearGroup,
  selectTriviaDone,
  selectTeammateDone,
  selectIsComplete,
  selectCurrentTriviaCardId,
  selectLastTeammateSlot,
  selectTotal,
  selectIsGameEnded,
} from './gameStore';
import type { Employee, TriviaCard } from '@/types/game';

const baseEmployee = (id: string, isLeader = false): Employee => ({
  id,
  name: `Emp-${id}`,
  initial: 'E',
  dept: 'ENG',
  year: 2024,
  isLeader,
});

const baseCard = (id: string): TriviaCard => ({
  id,
  index: 1,
  clue: `clue-${id}`,
  targetId: 'TARGET-X',
});

// Snapshot of the empty state defined in gameStore — reset() relies on this
// matching, so this is also a guard against drift.
const emptyShape = {
  profile: null,
  mission: null,
  trivia: { cards: [], stamps: {} },
  teammate: {
    year: null,
    leaderClue: null,
    leaderSlot: null,
    slots: [null, null, null, null, null],
  },
  pendingPenalty: null,
  pendingChat: null,
  chatBothAnsweredFor: null,
  pairMemoryPhoto: null,
  chatTarget: null,
  triviaIntroSeen: false,
  teammateIntroSeen: false,
  profileCriteriaSeen: false,
  gameEndedAt: null,
};

beforeEach(() => {
  // Reset between tests — store is module-singleton.
  useGame.getState().reset();
});

describe('formatYearGroup — SENIOR_COHORT_CUTOFF = 2023 (must mirror backend)', () => {
  it('returns "pre-2023" for hires before the cutoff', () => {
    expect(formatYearGroup(2022)).toBe('pre-2023');
    expect(formatYearGroup(2019)).toBe('pre-2023');
    expect(formatYearGroup(2010)).toBe('pre-2023');
  });

  it('returns "Class of YYYY" for 2023+', () => {
    expect(formatYearGroup(2023)).toBe('Class of 2023');
    expect(formatYearGroup(2024)).toBe('Class of 2024');
  });

  it('returns em-dash for null/undefined', () => {
    expect(formatYearGroup(null)).toBe('—');
    expect(formatYearGroup(undefined)).toBe('—');
  });
});

describe('selectTriviaDone — stamps count only', () => {
  it('counts the number of stamped cards', () => {
    useGame.setState((s) => ({
      trivia: {
        ...s.trivia,
        stamps: {
          'C1': baseEmployee('E1'),
          'C2': baseEmployee('E2'),
          'C3': baseEmployee('E3'),
        },
      },
    }));
    expect(selectTriviaDone(useGame.getState())).toBe(3);
  });

  it('returns 0 when no stamps', () => {
    expect(selectTriviaDone(useGame.getState())).toBe(0);
  });
});

describe('selectTeammateDone — excludes leaderSlot', () => {
  it('counts only non-null member slots, never leaderSlot', () => {
    useGame.setState((s) => ({
      teammate: {
        ...s.teammate,
        leaderSlot: baseEmployee('LEADER', true),
        slots: [baseEmployee('M1'), baseEmployee('M2'), null, null, null],
      },
    }));
    expect(selectTeammateDone(useGame.getState())).toBe(2);
  });

  it('is 0 when only the leader is filled', () => {
    useGame.setState((s) => ({
      teammate: {
        ...s.teammate,
        leaderSlot: baseEmployee('LEADER', true),
        slots: [null, null, null, null, null],
      },
    }));
    expect(selectTeammateDone(useGame.getState())).toBe(0);
  });
});

describe('selectIsComplete — leader is bonus, does NOT count', () => {
  it('5 stamps + 5 members → complete', () => {
    useGame.setState((s) => ({
      trivia: {
        ...s.trivia,
        stamps: {
          C1: baseEmployee('E1'),
          C2: baseEmployee('E2'),
          C3: baseEmployee('E3'),
          C4: baseEmployee('E4'),
          C5: baseEmployee('E5'),
        },
      },
      teammate: {
        ...s.teammate,
        slots: [
          baseEmployee('M1'),
          baseEmployee('M2'),
          baseEmployee('M3'),
          baseEmployee('M4'),
          baseEmployee('M5'),
        ],
      },
    }));
    expect(selectIsComplete(useGame.getState())).toBe(true);
    expect(selectTotal(useGame.getState())).toBe(10);
  });

  it('CRITICAL: 5 stamps + 4 members + 1 leader → NOT complete (leader is bonus)', () => {
    useGame.setState((s) => ({
      trivia: {
        ...s.trivia,
        stamps: {
          C1: baseEmployee('E1'),
          C2: baseEmployee('E2'),
          C3: baseEmployee('E3'),
          C4: baseEmployee('E4'),
          C5: baseEmployee('E5'),
        },
      },
      teammate: {
        ...s.teammate,
        leaderSlot: baseEmployee('LEADER', true),
        slots: [baseEmployee('M1'), baseEmployee('M2'), baseEmployee('M3'), baseEmployee('M4'), null],
      },
    }));
    expect(selectIsComplete(useGame.getState())).toBe(false);
    expect(selectTotal(useGame.getState())).toBe(9);
  });

  it('partial progress → not complete', () => {
    useGame.setState((s) => ({
      trivia: { ...s.trivia, stamps: { C1: baseEmployee('E1') } },
    }));
    expect(selectIsComplete(useGame.getState())).toBe(false);
  });
});

describe('selectCurrentTriviaCardId', () => {
  it('returns the first un-stamped card in assignedCardIds order', () => {
    useGame.setState({
      trivia: {
        cards: [baseCard('C1'), baseCard('C2'), baseCard('C3')],
        stamps: { C1: baseEmployee('E1') }, // C1 stamped, C2 is next
      },
    });
    expect(selectCurrentTriviaCardId(useGame.getState())).toBe('C2');
  });

  it('returns null when all assigned cards are stamped', () => {
    useGame.setState({
      trivia: {
        cards: [baseCard('C1'), baseCard('C2')],
        stamps: { C1: baseEmployee('E1'), C2: baseEmployee('E2') },
      },
    });
    expect(selectCurrentTriviaCardId(useGame.getState())).toBeNull();
  });

  it('returns first card when no stamps yet', () => {
    useGame.setState({
      trivia: { cards: [baseCard('C1'), baseCard('C2')], stamps: {} },
    });
    expect(selectCurrentTriviaCardId(useGame.getState())).toBe('C1');
  });
});

describe('selectLastTeammateSlot — walks backwards', () => {
  it('returns the highest-indexed non-null slot', () => {
    useGame.setState((s) => ({
      teammate: {
        ...s.teammate,
        slots: [baseEmployee('M1'), null, baseEmployee('M3'), null, null],
      },
    }));
    expect(selectLastTeammateSlot(useGame.getState())?.id).toBe('M3');
  });

  it('returns null when all slots are empty', () => {
    expect(selectLastTeammateSlot(useGame.getState())).toBeNull();
  });

  it('returns last slot when fully populated', () => {
    useGame.setState((s) => ({
      teammate: {
        ...s.teammate,
        slots: [
          baseEmployee('M1'),
          baseEmployee('M2'),
          baseEmployee('M3'),
          baseEmployee('M4'),
          baseEmployee('M5'),
        ],
      },
    }));
    expect(selectLastTeammateSlot(useGame.getState())?.id).toBe('M5');
  });
});

describe('selectIsGameEnded', () => {
  it('false when gameEndedAt is null', () => {
    expect(selectIsGameEnded(useGame.getState())).toBe(false);
  });

  it('true when gameEndedAt is set', () => {
    useGame.setState({ gameEndedAt: '2026-05-11T10:00:00.000Z' });
    expect(selectIsGameEnded(useGame.getState())).toBe(true);
  });
});

describe('reset()', () => {
  it('returns the store to the empty shape', () => {
    useGame.setState({
      profile: { ...baseEmployee('E1'), email: 'x@y.z' },
      gameEndedAt: '2026-05-11T10:00:00.000Z',
      trivia: { cards: [baseCard('C1')], stamps: { C1: baseEmployee('E1') } },
    });
    useGame.getState().reset();
    const s = useGame.getState();
    expect(s.profile).toEqual(emptyShape.profile);
    expect(s.gameEndedAt).toEqual(emptyShape.gameEndedAt);
    expect(s.trivia).toEqual(emptyShape.trivia);
    expect(s.teammate).toEqual(emptyShape.teammate);
  });
});

// =====================================================================
// Phase 2 — Actions with state
// =====================================================================

describe('addTeammateSlot — dedup, cap, leader exclusion', () => {
  it('fills the first empty slot', () => {
    useGame.getState().addTeammateSlot(baseEmployee('M1'));
    const s = useGame.getState();
    expect(s.teammate.slots[0]?.id).toBe('M1');
    expect(s.teammate.slots[1]).toBeNull();
  });

  it('appends to next empty slot in order', () => {
    useGame.getState().addTeammateSlot(baseEmployee('M1'));
    useGame.getState().addTeammateSlot(baseEmployee('M2'));
    useGame.getState().addTeammateSlot(baseEmployee('M3'));
    const s = useGame.getState();
    expect(s.teammate.slots.map((x) => x?.id ?? null)).toEqual(['M1', 'M2', 'M3', null, null]);
  });

  it('dedup: adding the same id twice is a no-op (no duplicate slot)', () => {
    useGame.getState().addTeammateSlot(baseEmployee('M1'));
    useGame.getState().addTeammateSlot(baseEmployee('M1'));
    const s = useGame.getState();
    expect(s.teammate.slots.filter((x) => x?.id === 'M1')).toHaveLength(1);
    expect(s.teammate.slots[1]).toBeNull();
  });

  it('blocks adding an employee who is already in leaderSlot', () => {
    useGame.setState((s) => ({
      teammate: { ...s.teammate, leaderSlot: baseEmployee('LEAD', true) },
    }));
    useGame.getState().addTeammateSlot(baseEmployee('LEAD', true));
    const s = useGame.getState();
    expect(s.teammate.slots.every((x) => x === null)).toBe(true);
  });

  it('no-op when all 5 member slots are full', () => {
    for (let i = 1; i <= 5; i++) {
      useGame.getState().addTeammateSlot(baseEmployee(`M${i}`));
    }
    useGame.getState().addTeammateSlot(baseEmployee('M6'));
    const s = useGame.getState();
    expect(s.teammate.slots.filter((x) => x !== null)).toHaveLength(5);
    expect(s.teammate.slots.find((x) => x?.id === 'M6')).toBeUndefined();
  });
});

describe('addLeaderSlot — single slot, member exclusion', () => {
  it('sets leaderSlot the first time', () => {
    useGame.getState().addLeaderSlot(baseEmployee('LEAD', true));
    expect(useGame.getState().teammate.leaderSlot?.id).toBe('LEAD');
  });

  it('no-op when leaderSlot is already filled (no overwrite)', () => {
    useGame.getState().addLeaderSlot(baseEmployee('LEAD1', true));
    useGame.getState().addLeaderSlot(baseEmployee('LEAD2', true));
    expect(useGame.getState().teammate.leaderSlot?.id).toBe('LEAD1');
  });

  it('no-op (no double-add) when called with the same leader twice', () => {
    useGame.getState().addLeaderSlot(baseEmployee('LEAD', true));
    useGame.getState().addLeaderSlot(baseEmployee('LEAD', true));
    expect(useGame.getState().teammate.leaderSlot?.id).toBe('LEAD');
  });

  it('blocks adding a leader who is already in member slots', () => {
    useGame.setState((s) => ({
      teammate: {
        ...s.teammate,
        slots: [baseEmployee('X'), null, null, null, null],
      },
    }));
    useGame.getState().addLeaderSlot(baseEmployee('X', true));
    expect(useGame.getState().teammate.leaderSlot).toBeNull();
  });
});

describe('hydrateProgress — splits teammateSlots by isLeader', () => {
  it('separates leader vs non-leaders into leaderSlot + 5-slot array', () => {
    useGame.getState().hydrateProgress({
      cards: [baseCard('C1')],
      triviaStamps: { C1: baseEmployee('T1') },
      teammateSlots: [
        baseEmployee('L', true),
        baseEmployee('M1'),
        baseEmployee('M2'),
      ],
      year: 2024,
      gameEndedAt: null,
      leaderClue: 'someone in design',
    });
    const s = useGame.getState();
    expect(s.teammate.leaderSlot?.id).toBe('L');
    expect(s.teammate.slots.map((x) => x?.id ?? null)).toEqual(['M1', 'M2', null, null, null]);
    expect(s.teammate.year).toBe(2024);
    expect(s.teammate.leaderClue).toBe('someone in design');
    expect(s.trivia.cards.map((c) => c.id)).toEqual(['C1']);
    expect(s.trivia.stamps['C1']?.id).toBe('T1');
  });

  it('edge: 6+ non-leaders → slice เหลือ 5 (defensive, backend should never send this)', () => {
    useGame.getState().hydrateProgress({
      cards: [],
      triviaStamps: {},
      teammateSlots: [
        baseEmployee('M1'),
        baseEmployee('M2'),
        baseEmployee('M3'),
        baseEmployee('M4'),
        baseEmployee('M5'),
        baseEmployee('M6'),
        baseEmployee('M7'),
      ],
      year: 2024,
      gameEndedAt: null,
      leaderClue: null,
    });
    const s = useGame.getState();
    expect(s.teammate.slots).toHaveLength(5);
    expect(s.teammate.slots.map((x) => x?.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
  });

  it('no leader in payload → leaderSlot stays null', () => {
    useGame.getState().hydrateProgress({
      cards: [],
      triviaStamps: {},
      teammateSlots: [baseEmployee('M1')],
      year: 2024,
      gameEndedAt: null,
      leaderClue: null,
    });
    expect(useGame.getState().teammate.leaderSlot).toBeNull();
  });

  it('propagates gameEndedAt straight through', () => {
    useGame.getState().hydrateProgress({
      cards: [],
      triviaStamps: {},
      teammateSlots: [],
      year: null,
      gameEndedAt: '2026-05-11T10:00:00.000Z',
      leaderClue: null,
    });
    expect(useGame.getState().gameEndedAt).toBe('2026-05-11T10:00:00.000Z');
  });
});

describe('setGameEnded — clears in-flight state', () => {
  it('sets gameEndedAt and clears chatTarget / pendingPenalty / pendingChat / chatBothAnsweredFor / pairMemoryPhoto', () => {
    useGame.setState({
      chatTarget: baseEmployee('X'),
      pendingPenalty: { pairId: 'p1', role: 'hunter' },
      pendingChat: { pairId: 'p1', role: 'target', counterpart: baseEmployee('X') },
      chatBothAnsweredFor: 'p1',
      pairMemoryPhoto: { pairId: 'p1', url: 'u', uploaderId: 'X', uploaderName: 'X' },
    });
    useGame.getState().setGameEnded('2026-05-11T10:00:00.000Z');
    const s = useGame.getState();
    expect(s.gameEndedAt).toBe('2026-05-11T10:00:00.000Z');
    expect(s.chatTarget).toBeNull();
    expect(s.pendingPenalty).toBeNull();
    expect(s.pendingChat).toBeNull();
    expect(s.chatBothAnsweredFor).toBeNull();
    expect(s.pairMemoryPhoto).toBeNull();
  });
});

describe('addTriviaStamp', () => {
  it('writes the stamp keyed by cardId', () => {
    useGame.getState().addTriviaStamp('C1', baseEmployee('T1'));
    expect(useGame.getState().trivia.stamps['C1']?.id).toBe('T1');
  });

  it('overwrites an existing stamp on the same cardId', () => {
    useGame.getState().addTriviaStamp('C1', baseEmployee('T1'));
    useGame.getState().addTriviaStamp('C1', baseEmployee('T2'));
    expect(useGame.getState().trivia.stamps['C1']?.id).toBe('T2');
  });
});

describe('intro-seen flags', () => {
  it('markTriviaIntroSeen flips the flag', () => {
    expect(useGame.getState().triviaIntroSeen).toBe(false);
    useGame.getState().markTriviaIntroSeen();
    expect(useGame.getState().triviaIntroSeen).toBe(true);
  });

  it('markTeammateIntroSeen flips the flag', () => {
    useGame.getState().markTeammateIntroSeen();
    expect(useGame.getState().teammateIntroSeen).toBe(true);
  });

  it('markProfileCriteriaSeen flips the flag', () => {
    useGame.getState().markProfileCriteriaSeen();
    expect(useGame.getState().profileCriteriaSeen).toBe(true);
  });
});
