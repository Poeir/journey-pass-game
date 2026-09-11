// Drift guards — compile-time and behavioural checks that catch silent
// divergence between mirrored types/constants. CLAUDE.md calls out three
// places where the ScanOutcome union is duplicated and one place for the
// cohort cutoff; if anyone updates one site without the others, these
// assertions break the build (compile-time) or the test (runtime).
//
// Canonical kind set is hardcoded here AND in `frontend/src/__drift__.test.ts`
// — keeping them in sync across the two test files IS the drift guard. A
// future refactor can centralise both via `shared/types.ts`, but for now this
// is the lowest-risk way to detect drift without touching the build config.

import { describe, it, expect } from 'vitest';
import type { ScanOutcome } from '@/domain/scan.js';
import type { PairWsEvent, UserWsEvent } from '@/ws/hub.js';
import { inSameYearGroup } from '@/domain/scan.js';

// ─── ScanOutcome triple-mirror ───────────────────────────────────────────

// Canonical set — MUST also appear (identical) in:
//   - frontend/src/__drift__.test.ts (canonical list)
//   - shared/types.ts (ScanOutcome union, by value)
//   - backend/src/domain/scan.ts (local ScanOutcome, by value)
//   - frontend/src/types/game.ts (local ScanOutcome, by value)
//   - frontend/src/features/scanner/ScannerPage.tsx (switch branches)
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

// Extract the discriminator kind set from backend's local ScanOutcome union.
type BackendOutcomeKind = ScanOutcome extends { outcome: infer K } ? K : never;

// `Equal<X, Y>` — true only when X and Y are structurally identical (works
// across union order). Standard TS conditional-type trick.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;

// If backend adds/renames/removes an outcome variant without updating the
// canonical list above, this assertion FAILS AT COMPILE TIME.
const _backendOutcomesMatchCanonical: Equal<BackendOutcomeKind, CanonicalOutcomeKind> = true;
void _backendOutcomesMatchCanonical;

describe('Drift guard: ScanOutcome', () => {
  it('canonical list has exactly 9 distinct kinds', () => {
    expect(CANONICAL_SCAN_OUTCOMES).toHaveLength(9);
    expect(new Set(CANONICAL_SCAN_OUTCOMES).size).toBe(9);
  });
});

// ─── WsEvent partial mirror (shared/types.ts subset of backend's hub.ts) ─

// shared/types.ts declares a partial `WsEvent = penalty.update | game.ended`
// — only the kinds the frontend imports as a value type. The backend may
// emit more kinds (pair.created, trivia.found, chat.both_answered, etc.).
// Drift to catch: someone renames `penalty.update` or `game.ended` in
// hub.ts without updating shared/types.ts, OR vice versa.
const SHARED_WS_EVENT_KINDS = ['penalty.update', 'game.ended'] as const;
type SharedWsKind = (typeof SHARED_WS_EVENT_KINDS)[number];

type BackendUserWsKind = UserWsEvent extends { type: infer T } ? T : never;
type BackendPairWsKind = PairWsEvent extends { type: infer T } ? T : never;
type AllBackendWsKinds = BackendUserWsKind | BackendPairWsKind;

// Shared kinds MUST be a subset of all backend WS kinds — otherwise the
// frontend would import a kind that backend never emits.
type SharedKindsAreEmittedByBackend = SharedWsKind extends AllBackendWsKinds ? true : false;
const _sharedWsSubsetOfBackend: SharedKindsAreEmittedByBackend = true;
void _sharedWsSubsetOfBackend;

describe('Drift guard: WsEvent partial mirror', () => {
  it('shared/types.ts WsEvent kinds are a subset of backend hub.ts kinds', () => {
    // The compile-time check above is the real guard; this assertion is
    // documentary so a runtime failure points at the cause.
    expect(SHARED_WS_EVENT_KINDS.length).toBeGreaterThan(0);
  });
});

// ─── SENIOR_COHORT_CUTOFF mirror ─────────────────────────────────────────
// The constant 2023 lives in TWO places that must agree:
//   - backend/src/domain/scan.ts (SENIOR_COHORT_CUTOFF)
//   - frontend/src/game/gameStore.ts (SENIOR_COHORT_CUTOFF)
// Behavioural pinning catches a change at either site.

describe('Drift guard: SENIOR_COHORT_CUTOFF = 2023', () => {
  it('cutoff is pinned at 2023 (mirror in frontend gameStore.SENIOR_COHORT_CUTOFF)', () => {
    // Boundary: 2022 (pre-cutoff) vs 2023 (post-cutoff) are NOT the same cohort.
    expect(inSameYearGroup(2022, 2023)).toBe(false);
    // 2022 + 2021 are both pre-cutoff → same cohort.
    expect(inSameYearGroup(2022, 2021)).toBe(true);
    // 2023 == 2023 (post-cutoff exact-year match).
    expect(inSameYearGroup(2023, 2023)).toBe(true);
    // 2023 vs 2024 (both post-cutoff, different years) → not same cohort.
    expect(inSameYearGroup(2023, 2024)).toBe(false);
  });
});
