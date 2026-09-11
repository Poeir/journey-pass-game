// Drift guards (frontend side). Paired with `backend/src/__drift__.test.ts`.
// The CANONICAL_SCAN_OUTCOMES list below MUST stay identical in both files —
// keeping them in sync IS the drift guard. If a future refactor centralises
// the type in `shared/types.ts` and both sides import it, this guard becomes
// redundant and can be deleted.

import { describe, it, expect } from 'vitest';
import type { ScanOutcome } from '@/types/game';
import { formatYearGroup } from '@/game/gameStore';

// ─── ScanOutcome triple-mirror ───────────────────────────────────────────
const CANONICAL_SCAN_OUTCOMES = [
  'match',
  'mismatch',
  'chat',
  'wrong_year',
  'wrong_leader',
  'leader_clash',
  'already_added',
  'leader_full',
  'teammate_full',
] as const;
type CanonicalOutcomeKind = (typeof CANONICAL_SCAN_OUTCOMES)[number];

type FrontendOutcomeKind = ScanOutcome extends { outcome: infer K } ? K : never;

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;

// Compile-time assertion: frontend's ScanOutcome kinds == canonical list.
const _frontendOutcomesMatchCanonical: Equal<FrontendOutcomeKind, CanonicalOutcomeKind> = true;
void _frontendOutcomesMatchCanonical;

describe('Drift guard: ScanOutcome (frontend)', () => {
  it('canonical list has exactly 9 distinct kinds (mirrors backend)', () => {
    expect(CANONICAL_SCAN_OUTCOMES).toHaveLength(9);
    expect(new Set(CANONICAL_SCAN_OUTCOMES).size).toBe(9);
  });
});

// ─── SENIOR_COHORT_CUTOFF mirror ─────────────────────────────────────────
describe('Drift guard: SENIOR_COHORT_CUTOFF = 2023 (frontend)', () => {
  it('formatYearGroup boundary pins cutoff at 2023 (mirror in backend scan.SENIOR_COHORT_CUTOFF)', () => {
    expect(formatYearGroup(2022)).toBe('pre-2023');
    expect(formatYearGroup(2023)).toBe('Class of 2023');
    expect(formatYearGroup(2024)).toBe('Class of 2024');
  });
});
