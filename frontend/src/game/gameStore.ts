import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CardId,
  Employee,
  EmployeeId,
  MissionKind,
  PairId,
  Profile,
  TriviaCard,
} from '@/types/game';

interface GameState {
  profile: Profile | null;
  mission: MissionKind | null;
  trivia: {
    cards: TriviaCard[];
    stamps: Record<CardId, Employee>;
  };
  teammate: {
    year: number | null;
    leaderClue: string | null;
    leaderSlot: Employee | null;
    slots: (Employee | null)[];   // 5 regular member slots (leader is extra/optional)
  };
  pendingPenalty: { pairId: PairId; role: 'hunter' | 'target' } | null;
  // Drives the GameShell auto-redirect into /chat/:pairId for the target side
  // of a teammate scan. Set by the WS handler on `pair.created` (mode=teammate)
  // or by the /me/pending-chat hydrate. Cleared once that side submits the
  // chat-confirm. Hunter side doesn't need this — ScannerPage navigates them
  // into /chat/:pairId directly with chatTarget set.
  pendingChat: { pairId: PairId; role: 'hunter' | 'target'; counterpart: Employee } | null;
  // Cross-page signal raised when the OTHER side of a teammate chat finishes
  // their answer — ChatConfirmPage watches it to release its "waiting for
  // them to finish" state and navigate both phones into SuccessPage at the
  // same moment. Holds just the pairId so multiple stale events can't
  // collide. Cleared on navigation.
  chatBothAnsweredFor: PairId | null;
  // Cross-page signal raised when the scanner uploads the shared memory
  // photo — SuccessPage on the target side watches it to flip from the
  // "waiting for them to capture" UI to the actual photo without a refetch.
  pairMemoryPhoto: {
    pairId: PairId;
    url: string;
    uploaderId: string;
    uploaderName: string;
  } | null;
  chatTarget: Employee | null;
  triviaIntroSeen: boolean;
  teammateIntroSeen: boolean;
  profileCriteriaSeen: boolean;
  gameEndedAt: string | null;

  setProfile: (p: Profile | null) => void;
  setMission: (m: MissionKind | null) => void;
  startTrivia: (cards: TriviaCard[]) => void;
  addTriviaStamp: (cardId: CardId, target: Employee) => void;
  startTeammate: (year: number, leaderClue: string | null) => void;
  addLeaderSlot: (emp: Employee) => void;
  addTeammateSlot: (emp: Employee) => void;
  setPenalty: (p: GameState['pendingPenalty']) => void;
  setPendingChat: (c: GameState['pendingChat']) => void;
  setChatBothAnswered: (pairId: PairId | null) => void;
  setPairMemoryPhoto: (p: GameState['pairMemoryPhoto']) => void;
  setChatTarget: (t: Employee | null) => void;
  markTriviaIntroSeen: () => void;
  markTeammateIntroSeen: () => void;
  markProfileCriteriaSeen: () => void;
  setGameEnded: (endedAt: string) => void;
  hydrateProgress: (data: {
    cards: TriviaCard[];
    triviaStamps: Record<CardId, Employee>;
    teammateSlots: Employee[];
    year: number | null;
    gameEndedAt: string | null;
    leaderClue: string | null;
  }) => void;
  reset: () => void;
}

const emptyState = {
  profile: null,
  mission: null,
  trivia: { cards: [], stamps: {} },
  teammate: {
    year: null,
    leaderClue: null as string | null,
    leaderSlot: null as Employee | null,
    slots: [null, null, null, null, null] as (Employee | null)[],
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

export const useGame = create<GameState>()(
  persist(
    (set) => ({
      ...emptyState,
      setProfile: (profile) => set({ profile }),
      setMission: (mission) => set({ mission }),
      startTrivia: (cards) => set({ trivia: { cards, stamps: {} } }),
      addTriviaStamp: (cardId, target) =>
        set((s) => ({ trivia: { ...s.trivia, stamps: { ...s.trivia.stamps, [cardId]: target } } })),
      startTeammate: (year, leaderClue) =>
        set((s) => ({ teammate: { ...s.teammate, year, leaderClue } })),
      addLeaderSlot: (emp) =>
        set((s) => {
          if (s.teammate.leaderSlot?.id === emp.id) return s;
          if (s.teammate.leaderSlot) return s;
          if (s.teammate.slots.some((x) => x?.id === emp.id)) return s;
          return { teammate: { ...s.teammate, leaderSlot: emp } };
        }),
      addTeammateSlot: (emp) =>
        set((s) => {
          if (s.teammate.leaderSlot?.id === emp.id) return s;
          if (s.teammate.slots.some((x) => x?.id === emp.id)) return s;
          const next = s.teammate.slots.slice();
          const i = next.findIndex((x) => x === null);
          if (i < 0) return s;
          next[i] = emp;
          return { teammate: { ...s.teammate, slots: next } };
        }),
      setPenalty: (pendingPenalty) => set({ pendingPenalty }),
      setPendingChat: (pendingChat) => set({ pendingChat }),
      setChatBothAnswered: (chatBothAnsweredFor) => set({ chatBothAnsweredFor }),
      setPairMemoryPhoto: (pairMemoryPhoto) => set({ pairMemoryPhoto }),
      setChatTarget: (chatTarget) => set({ chatTarget }),
      markTriviaIntroSeen: () => set({ triviaIntroSeen: true }),
      markTeammateIntroSeen: () => set({ teammateIntroSeen: true }),
      markProfileCriteriaSeen: () => set({ profileCriteriaSeen: true }),
      setGameEnded: (endedAt) =>
        set({
          gameEndedAt: endedAt,
          chatTarget: null,
          pendingPenalty: null,
          pendingChat: null,
          chatBothAnsweredFor: null,
          pairMemoryPhoto: null,
        }),
      hydrateProgress: ({ cards, triviaStamps, teammateSlots, year, gameEndedAt, leaderClue }) =>
        set(() => {
          const leader = teammateSlots.find((e) => e.isLeader === true) ?? null;
          const nonLeaders = teammateSlots.filter((e) => !e.isLeader);
          const slots: (Employee | null)[] = [null, null, null, null, null];
          nonLeaders.slice(0, 5).forEach((e, i) => { slots[i] = e; });
          return {
            trivia: { cards, stamps: triviaStamps },
            teammate: {
              year,
              leaderClue,
              leaderSlot: leader,
              slots,
            },
            gameEndedAt,
          };
        }),
      reset: () => set(emptyState),
    }),
    {
      name: 'journey-pass-5.5',
      version: 7,
    }
  )
);

// Teammate cohort labelling. Mirror of `inSameYearGroup` in
// backend/src/domain/scan.ts: 2022-and-earlier hires are one cohort; 2023+ split by year.
const SENIOR_COHORT_CUTOFF = 2023;
export function formatYearGroup(year: number | null | undefined): string {
  if (year === null || year === undefined) return '—';
  if (year < SENIOR_COHORT_CUTOFF) return `pre-${SENIOR_COHORT_CUTOFF}`;
  return `Class of ${year}`;
}

export const selectTriviaDone = (s: GameState) => Object.keys(s.trivia.stamps).length;
// First card in assignedCardIds order (preserved by backend) that hasn't been stamped yet.
// null when all cards are done.
export const selectCurrentTriviaCardId = (s: GameState): CardId | null => {
  for (const card of s.trivia.cards) {
    if (s.trivia.stamps[card.id] === undefined) return card.id;
  }
  return null;
};
// Leader is an optional "extra" and does not count toward the 5 required members.
export const selectTeammateDone = (s: GameState) =>
  s.teammate.slots.filter((x) => x !== null).length;
// Most recently filled member slot (highest non-null index). Walks backwards
// instead of `.filter().at(-1)` so we don't allocate a temp array on every
// render — SuccessPage subscribes to `slots` and re-renders frequently.
export const selectLastTeammateSlot = (s: GameState): Employee | null => {
  const { slots } = s.teammate;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i] !== null) return slots[i];
  }
  return null;
};
export const selectTotal = (s: GameState) => selectTriviaDone(s) + selectTeammateDone(s);
export const selectIsComplete = (s: GameState) => selectTotal(s) >= 10;
export const selectIsGameEnded = (s: GameState) => s.gameEndedAt !== null;
