# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the frontend-specific guide. The root `../CLAUDE.md` covers the monorepo layout and cross-cutting conventions; read it first.

## Commands

All commands run from the `frontend/` directory.

- `npm run dev` — Vite dev server on port 5173.
- `npm run typecheck` — `tsc --noEmit`. Run this to validate types without emitting.
- `npm run build` — `tsc --noEmit && vite build`. Typecheck is part of the build, not skippable.
- `npm run preview` — preview the built bundle.
- `npm run lhci` — Lighthouse CI run (`@lhci/cli`).

There is no test runner or linter configured. "Tests pass" means `typecheck` returns exit 0 and the golden-path flow works in the browser. Since this is a mobile-first camera-driven app, UI/feature verification requires `npm run dev` + a browser — the typecheck alone does not prove the flow works.

Backend wiring:
- `VITE_API_BASE=<url>/api` — REST base.
- `VITE_WS_BASE=wss://<url>/api` — WS base. If unset, `useUserSocket` derives it from `VITE_API_BASE` (swapping `http` → `ws`, or falling back to `window.location` + `/api`).
- `VITE_DEV_LOGIN_ENABLED=true` — gates the dev-login picker on the welcome page. Must match the backend's `DEV_LOGIN_ENABLED` for the calls to actually work; otherwise the UI hits a 404.

## Architecture

### Routing & shells (`src/router.tsx`)
The app has **two** shells:

1. **`GameShell`** — the player game UI. Wraps the welcome / mission / scanner / result / projector pages. Public projector pages (`/memory`, `/ranking`) live INSIDE `GameShell` but skip its chrome. Auth-gated routes are nested inside an `<RequireAuth />` element.
2. **`AdminShell`** — the admin portal at `/admin/*`. Its own sidebar layout, no game chrome. Adds `admin-fullscreen` to `<html>` so the page breaks out of the global "phone column" frame.

There is no `/login` route in the player flow. Login is Azure SSO — the welcome page redirects to `${API_BASE}/auth/azure/login`, the backend callback sets the cookie and redirects to `/user`. Login errors come back as `?error=auth_failed` / `?error=not_registered` / `?expired=1` on `/`, and `WelcomePage` renders an inline banner.

Admin auth has its own `/admin/login` route that lives **outside** `<AdminShell />` (otherwise the shell's bounce-to-login effect would loop).

All non-entry pages are lazy-loaded via `React.lazy`. `WelcomePage` stays eager so the first paint doesn't have to wait for an extra chunk download (Lighthouse flags an empty Suspense fallback as NO_FCP).

Game route table (under `<GameShell />`):
- `/` → `WelcomePage` — Azure SSO entry. Reads `?error=` / `?expired=1`. When `VITE_DEV_LOGIN_ENABLED=true`, exposes a dev-login picker that calls `devAuthEndpoints.listEmployees()` + `.login(employeeId)`. Auto-redirects to `/user` if a session is already hydrated.
- `/memory` → `MemoryWallPage` — **public** projector view, no auth, no shell chrome.
- `/ranking` → `RankingPage` — **public** projector view of who has finished and who is still playing (with "X quests left" + last-activity relative time). Backed by `GET /completion/ranking`. Polls every 10s.
- All routes below are wrapped in `<RequireAuth />` (which does a one-shot `/me` hydrate before bouncing to `/`):
  - `/user` → `UserProfilePage`
  - `/missions` → `MissionSelectPage`
  - `/missions/trivia` → `TriviaIntroPage` (skipped via `triviaIntroSeen`)
  - `/missions/trivia/cards` → `TriviaCardsPage`
  - `/missions/trivia/:cardId/scan` → `<ScannerPage mode="trivia" />`
  - `/missions/teammate` → `TeammateIntroPage` (skipped via `teammateIntroSeen`)
  - `/missions/teammate/list` → `FindTeammatePage`
  - `/missions/teammate/scan` → `<ScannerPage mode="teammate" />`
  - `/result/success?ref=...` → `SuccessPage` (carries an optional `&role=leader` flag)
  - `/result/fail/:pairId` → `FailPenaltyPage` (target uploads photo proof; hunter waits)
  - `/chat/:pairId` → `ChatConfirmPage` (fetches the pair's deterministic chat question via `GET /chat/:pairId/question`, calls `POST /chat/:pairId/confirm-teammate`)
  - `/complete` → `CompletedPage` — fires `POST /completion` on mount (idempotent). Single point that stamps `PlayerProgress.completedAt`.
  - `/time-up` → `TimeUpPage` — landing page when `gameEndedAt` is set; `GameShell` redirects here automatically.
- `*` → `NotFoundPage`

Admin route table (under `<AdminShell />`, gated by `requireAdmin` server-side and a session check client-side):
- `/admin` → `AdminDashboard`
- `/admin/players` + `/admin/players/:id` (force-grant stamps, force-add teammates, reroll cards, mark/unmark complete, reset progress, set assigned leader)
- `/admin/employees` (CRUD)
- `/admin/trivia` (CRUD; M2M targets via `set:`)
- `/admin/pairs` (force-clear unconfirmed trivia rounds)
- `/admin/scans` (cursor-paginated audit log)
- `/admin/memories` (delete photos; Cloudinary destroy is best-effort)
- `/admin/game` (clock display, redistribute leaders, danger-zone wipes)
- `/admin/settings`
- `/admin/login` lives outside the shell.

`AdminShell` calls `adminAuthEndpoints.me()` on mount and bounces to `/admin/login` when `isAdmin === false`. The api client (`api/client.ts`) is configured to NOT auto-redirect on 401 from `/admin/*` paths — that bouncing is `AdminShell`'s job, and a stale `/me` 401 must NOT yank the user off the admin portal.

### `GameShell` cross-page chrome
1. **`ProgressDock`** (bottom): trivia / teammate progress bar + profile button. Hidden on the scanner (immersive), on `/` (unauthenticated), on `/memory` and `/ranking` (public projectors), and on `/time-up` (game-over takeover).
2. **`MyQRSheet`**: opened by setting `?qr=open` in the URL, *not* by component-local state. Any page can open it. Lazy-loaded.

`GameShell` also performs **session hydration on profile change**: it calls `authEndpoints.pendingPenalty()` (rehydrates `pendingPenalty`) and `authEndpoints.progress()` (rehydrates trivia stamps + teammate slots + leaderClue + gameEndedAt into the store). Two redirect effects:
- When `gameEndedAt` is set, replace-redirect to `/time-up` (unless we're on welcome, a projector page, or already on time-up).
- When `pendingPenalty` is set (either role), replace-redirect to `/result/fail/:pairId` on every render unless we're already there or on welcome/projector. **Neither side can escape an unconfirmed penalty** — the hunter waits for the target to upload the proof photo, and the target gets pulled into the same page so they can't avoid uploading. The realtime trigger for the target side is `useUserSocket`: on a `pair.created` frame for `mode='trivia'` + `role='target'` it calls `setPenalty(...)`, which the redirect effect picks up.

`App.tsx` does a startup `/me` hydrate to verify/refresh the session — but **skips the call when the URL is `/admin*`** so an admin-only user opening `/admin` doesn't get their (possibly fine) game profile cleared by a 401.

All paths should be built via `src/lib/routes.ts`. `ROUTES.chatConfirm(pairId)`, `ROUTES.fail(pairId)`, `ROUTES.success(ref)`, etc. Add a builder there whenever you add a route.

### Game state (`src/game/gameStore.ts`)
One global Zustand store, persisted via `zustand/middleware/persist`:

- Persist key: `journey-pass-5.5`
- Persist version: **6** — bump on any breaking shape change or users will see stale/broken state on next load.

Shape highlights:
- `profile: Profile | null` — set by `App.tsx` / `RequireAuth` after `authEndpoints.me()` succeeds. There is no client-side login call — the cookie is set by the SSO callback before the SPA mounts.
- `trivia: { cards: TriviaCard[]; stamps: Record<CardId, Employee> }` — `cards` is the player's **assigned** 5 cards (returned by `/missions/trivia/start`, persisted backend-side on `PlayerCardAssignment`).
- `teammate: { year, leaderClue, leaderSlot, slots: (Employee | null)[5] }` — `leaderClue` is the hint for the player's assigned leader (from `/missions/teammate/start` or `/me/progress`). **`leaderSlot` is "extra" / bonus** (not required for completion) and lives on its own field. The 5-element `slots` is positional and holds the **5 required non-leader members**: `addTeammateSlot` fills the first `null` and refuses if all are occupied or the employee is already in any slot (including `leaderSlot`). `addLeaderSlot` is a no-op if `leaderSlot` is set or the employee is in `slots`. `selectTeammateDone` returns the count of filled member slots **only** — the leader is excluded. So `selectIsComplete` (`selectTotal >= 10`) needs 5 trivia stamps + 5 members; the leader is a bonus stamp on the passport, not a requirement.
- `pendingPenalty: { pairId, role } | null` — for the auto-redirect in `GameShell`.
- `chatTarget: Employee | null` — load-bearing handoff between scanner and chat-confirm. The scanner sets it on `outcome: 'chat'`; `ChatConfirmPage` consumes it on submit (calls `addLeaderSlot` if `chatTarget.isLeader`, else `addTeammateSlot`) and clears it.
- `triviaIntroSeen` / `teammateIntroSeen` / `profileCriteriaSeen` — make their respective pages auto-skip on second visit.
- `gameEndedAt: string | null` — set when the user WS receives `game.ended` (or rehydrated by `/me/progress`); `GameShell` uses it to redirect to `/time-up`. `setGameEnded` also clears `chatTarget` and `pendingPenalty` so the user doesn't get stuck mid-flow at game-end.
- `hydrateProgress({ cards, triviaStamps, teammateSlots, year, gameEndedAt, leaderClue })` — called by `GameShell` after login. Splits `teammateSlots` by `isLeader` into `leaderSlot` + the 5-element member array, and writes `gameEndedAt` and `leaderClue` straight through.

The store is both a hook (`useGame((s) => s.profile)`) and a static facade (`useGame.getState().addTeammateSlot(emp)`). Use `getState()` from inside event handlers that navigate immediately afterwards — subscribing via the hook there causes an unneeded re-render before unmount.

`formatYearGroup(year)` mirrors the backend's `inSameYearGroup` cutoff (`SENIOR_COHORT_CUTOFF = 2023`): pre-2023 hires are labeled as one cohort, 2023+ split by year. Keep this constant in sync with `backend/src/domain/scan.ts`.

Selectors at the bottom (`selectTriviaDone`, `selectCurrentTriviaCardId`, `selectTeammateDone`, `selectLastTeammateSlot`, `selectTotal`, `selectIsComplete`, `selectIsGameEnded`) are the canonical way to compute progress; don't re-derive at call sites. `selectLastTeammateSlot` walks the array backwards so SuccessPage doesn't allocate a temp array on every render. `selectCurrentTriviaCardId` returns the first assigned card without a stamp, in `assignedCardIds` order.

### i18n (`src/lib/i18n/`)
Bilingual UI. Default `th`, fallback `en`.

- `languageStore.ts` — Zustand store, persisted (`jp_lang`, version 1). `useLanguageStore((s) => s.lang)`, `setLang('en' | 'th')`.
- `locales/en.ts` + `locales/th.ts` — same nested object shape, dot-paths are the lookup keys.
- `useT.ts` — three exports:
  - `useT()` — hook for components, re-renders on language change.
  - `t(key, vars?)` — imperative version for use outside React render (event handlers, stores, mappers). Reads `useLanguageStore.getState().lang` so it does not re-render anything.
  - `tList(key)` — for arrays (random pickers, etc.). Falls back to `en`, then `[]`.
  - Variable interpolation is `{name}` style; missing vars stay as `{name}` literally.
- `LanguageToggle` (in `src/design-system/`) flips between TH/EN. The welcome page header places this next to the 5.5 badge.

When adding new copy: add the key to BOTH locale files. Missing keys fall back through `en` and finally to the key string itself, so a missing translation is debuggable but ugly in prod. Don't hard-code Thai or English strings in feature files — go through `t(...)`.

### API layer
- `src/api/client.ts` — `api.get` / `post` / `patch` / `delete` / `postForm` (multipart), all with `credentials: 'include'`. Throws `ApiError` carrying `status`, `body`, optional `code`. Network errors push a localized "couldn't reach the server" toast. **401 handling is path-dependent** — `/admin/*` 401s are passed through (AdminShell handles them), other 401s clear `profile` and redirect to `/?expired=1` (except on `/`, `/memory`, and `/admin*` where redirecting would loop or yank the user off a valid page). Other failures push a localized toast via `useErrorStore` (`describeHttpError(status, code)` covers 400/403/404/409/5xx).
- `src/api/endpoints.ts` — typed wrappers grouped by feature:
  - `authEndpoints` — `logout`, `me`, `pendingPenalty`, `progress`, `criteria`, `finalizeAll`.
  - `devAuthEndpoints` — `listEmployees`, `login(employeeId)`. Backend only registers these when `DEV_LOGIN_ENABLED=true`.
  - `missionEndpoints` — `startTrivia`, `startTeammate`.
  - `scanEndpoints` — `scan`, `confirmPenalty(pairId, photo)`, `getPenaltyState(pairId)`.
  - `chatEndpoints` — `getQuestion(pairId)`, `confirmTeammate(pairId, answer)`.
  - `completionEndpoints` — `markComplete`.
  - `memoryEndpoints` — `upload(photo, contextKind, contextId, counterpartId)`.
  - `memoryWallEndpoints` — `list`.
  - `rankingEndpoints` — `list`.
  - `adminAuthEndpoints` — `login`, `logout`, `me`.
  - `adminEndpoints` — full admin CRUD surface (dashboard / players / employees / trivia / pairs / scans / memories / game). Mirrors `backend/src/routes/admin.ts`. Add new admin endpoints here so call sites stay typed.

Add new endpoints here so call sites stay typed.

### Scanner flow (`src/features/scanner/ScannerPage.tsx`)
Wraps `html5-qrcode`, mounted in two modes via prop (`trivia` | `teammate`). The decoded QR text is the target `Employee.id`. Same-payload scans within 3s are deduped (`lastScanRef`). A configurable `cooldown` after error/info outcomes re-arms the camera. Self-scan (`payload === profile.id`) shows an info toast and 3s cooldown.

Outcome routing (mirrors the nine-variant backend `ScanOutcome`):
- `trivia` mode:
  - `match` → `addTriviaStamp(card.id, target)`, navigate to `/result/success?ref=<cardId>`.
  - `mismatch` → `setPenalty({ pairId, role: 'hunter' })`, navigate to `/result/fail/:pairId`.
- `teammate` mode:
  - `chat` → `setChatTarget(target)`, navigate to `/chat/:pairId`. The chat-confirm page reads `chatTarget` to decide leader vs member slot. If you add another path that routes into `/chat/:pairId`, it must also `setChatTarget` first.
  - `wrong_year` → toast `t('scanner.wrongYear', { name })`, 3s cooldown, re-scan. Backend bypasses this for `isLeader` targets, so leaders never trigger it.
  - `wrong_leader` → toast `t('scanner.wrongLeader', { name })`, 3s cooldown. Fires when the scanned leader doesn't match the player's `assignedLeaderId`.
  - `leader_clash` → toast `t('scanner.leaderClash')`, 3s cooldown. Fires when both scanner and target are leaders.
  - `already_added` → info toast `t('scanner.alreadyAdded', { name })`, 3s cooldown.
  - `leader_full` → error toast `t('scanner.leaderFull')`, 3s cooldown.
  - `teammate_full` → error toast `t('scanner.teammateFull')`, 3s cooldown.

The scanner has two manual fallbacks: a **"Type ID"** button (always available, used when QR scanning is flaky in the field) and a **camera-error fallback form** with a manual ID input shown when `html5Qrcode.start` throws. Both pipe through the same `handleDecoded` as a real scan.

### Penalty flow (`src/features/result/FailPenaltyPage.tsx`)
The penalty round is **one-sided**: hunter does nothing but wait, target uploads a photo to confirm. The page subscribes to the pair channel via `usePairSocket` and updates on `penalty.update`. Penalty text comes from `GET /penalty/:pairId` (`penalty.text`); the frontend does not pick from a local list anymore — the pool lives in the backend `Penalty` table. The target's photo is uploaded via `scanEndpoints.confirmPenalty(pairId, photo)` (multipart to `POST /penalty/:pairId/confirm`); on success the backend writes a `MemoryPhoto` row (`contextKind=PENALTY`) so the proof shows up on `/memory`.

### Chat confirm flow (`src/features/result/ChatConfirmPage.tsx`)
Fetches the pair's deterministic chat question on mount (8s soft timeout → "retry" UI). On submit: `POST /chat/:pairId/confirm-teammate { answer }`, then locally calls `addLeaderSlot(target)` or `addTeammateSlot(target)` based on `chatTarget.isLeader`, clears `chatTarget`, navigates to `/result/success?ref=<pairId>` (with `&role=leader` when applicable so SuccessPage shows the leader-specific copy).

### Memory wall + photo capture
- `src/features/memoryWall/MemoryWallPage.tsx` — public, no shell chrome. Polls `GET /memories/wall` and renders the photo grid. `kind` is `memory` (trivia/teammate uploads) or `penalty` (penalty proofs).
- `src/features/ranking/RankingPage.tsx` — public, no shell chrome. Polls `GET /completion/ranking`.
- `src/lib/PhotoCapture.tsx` — shared camera + file-picker UI. Used by both `FailPenaltyPage` (penalty proof) and the success-page memory upload flow.
- `src/lib/compressImage.ts` — client-side downscale before upload (MAX_DIMENSION 1024) so we don't blow the backend's 8MB multipart cap on modern phones.

### Realtime stack
The notification UI (bell, history sheet, top-anchored auto-prompt) was removed — the user channel is load-bearing **only** for two state transitions, and the user is steered into the right page via `GameShell` redirects instead of a notification prompt.

1. **`src/lib/useUserSocket.ts`** — connects to `/api/ws/user` once `profile.id` is available (via `GameShell`). Auto-reconnects with exponential backoff capped at 30s + jitter, pauses while the tab is hidden, force-reconnects on `visibilitychange` when the tab returns. On socket open it fetches `/me/pending-penalty` and writes it into `gameStore.pendingPenalty` (covers the case where the target was offline when the broadcast went out — the WS hub does not replay missed frames). On message it acts on two event types:
   - `game.ended` → `setGameEnded(endedAt)`.
   - `pair.created` with `mode='trivia'` + `role='target'` → `setPenalty({ pairId, role: 'target' })`.
   The hunter side of `pair.created` is set by the scanner pre-navigate, so it doesn't need a WS handler. `trivia.found`, teammate-side `pair.created`, and `penalty.update` user-channel frames are intentional no-ops on the frontend now (the backend still emits them; we just don't render anything).
2. **`src/lib/useWebSocket.ts`** (`usePairSocket`) — pair-channel subscription used by `FailPenaltyPage` to react to `penalty.update` for the specific `pairId` it's showing. This is how both hunter and target see the proof appear in real time.

`src/lib/errorStore.ts` is the toast bus used by both the API layer and the scanner. `describeHttpError(status, code)` centralizes the error-copy mapping, including the `409 game_ended` / `409 not_yet_ended` cases.

### Admin portal (`src/features/admin/`)
- `AdminShell.tsx` — sidebar layout, Thai nav labels, language toggle in the header. Adds `admin-fullscreen` to `<html>` to break out of the global mobile column. Bounces to `/admin/login` when `adminAuthEndpoints.me()` returns `isAdmin: false`.
- `AdminLogin.tsx` — username + password form against `POST /admin/auth/login`.
- One feature page per admin route (`AdminDashboard`, `AdminPlayers`, `AdminPlayerDetail`, `AdminEmployees`, `AdminTrivia`, `AdminPairs`, `AdminScans`, `AdminMemories`, `AdminGame`, `AdminSettings`). Most consume `adminEndpoints.*` directly via `useAdminData.ts`-style hooks.
- `BACKEND.md` is the original spec doc (predates the implementation in `backend/src/routes/admin.ts`); use it as a reference but treat the backend code as authoritative.

### Design system & CSS (`src/design-system/`)
Composing primitives is preferred over raw elements; `Card` takes a `tone` prop (`sky`, `peach`, etc.) that swaps the accent color, use that instead of CSS overrides when you need a different color variant.

Current primitives:
- Layout / chrome: `IntroShell`, `PageHeader`, `Sheet`, `SectionLabel`, `InfoPanel`, `Note`.
- Inputs / actions: `Button`, `PassportButton`, `LanguageToggle`.
- Display: `Avatar`, `Card`, `EmployeeRow`, `Pill`, `ProgressBar`, `ScanFrame`, `Stamp`, `Toast`.
- `icons.tsx` — shared icon set imported across primitives.

Three stylesheet layers, imported once in `src/main.tsx` in this order:
1. `styles/tokens.css` — design tokens (`--venio-bluetiful`, `--gf-flame`, gray scale, fonts). Always reference tokens, never hardcode hex.
2. `styles/accents.css` — sketch / hand-drawn classes (`sk-hand`, `sk-hand-b`, `sk-bubble`, `sk-stamp`, `sk-trivia-card`). These are globally available utility classes.
3. `styles/global.css` — layout resets.

Feature pages co-locate `FeatureName.tsx` and `FeatureName.css`; the CSS uses BEM-like prefixes (`.chat__head`, `.scanner__overlay`). When you need to re-skin a globally-themed accent for one page (e.g., the orange `.sk-bubble--me` inside the chat), scope it with the page class (`.chat .sk-bubble--me { ... }`) rather than editing the global.

### Path alias
`@/*` resolves to `src/*` (configured in both `tsconfig.json` and `vite.config.ts`). Use it for all cross-feature imports.

### Language
UI copy is fully bilingual via the i18n module; default is Thai, English is the fallback. New strings go through `t(...)` / `useT()` and into both locale files. Don't hard-code language-specific strings in components.
