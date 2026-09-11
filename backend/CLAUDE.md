# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is the backend-specific guide. The root `../CLAUDE.md` covers the monorepo layout and cross-cutting conventions; read it first. This file fills in file-level detail and the gotchas that aren't obvious from the source.

## Commands

All commands run from the `backend/` directory. There is no test runner and no linter — "passing" means `typecheck` is clean and the golden-path flow works end-to-end against the real DB.

- `npm run dev` — `tsx watch --env-file=.env src/server.ts` with pino-pretty logs. Hot-reloads on save.
- `npm run typecheck` — `tsc --noEmit`. Use this to validate types without producing `dist/`.
- `npm run build` — `prisma generate && tsc -p tsconfig.json && tsc-alias -p tsconfig.json`. Path-alias rewriter is mandatory: `@/...` imports won't resolve at runtime without `tsc-alias` rewriting them in the emitted JS.
- `npm start` — production: `prisma migrate deploy && node --env-file=.env dist/server.js`. Applies committed migrations under `prisma/migrations/`. **Do not regress this to `db push --accept-data-loss`** — that flag drops columns on schema drift; `migrate deploy` is the prod-safe path. See `DEPLOY.md`.
- `npm run prisma:migrate -- --name <name>` — create a dev migration.
- `npm run prisma:reset` — wipe and re-seed local DB. You must `npm run seed` after; Prisma's reset hook does not run our seed.
- `npm run seed` — runs `scripts/seed.ts`. Required after any reset / `migrate deploy` against an empty DB or login returns 401. Seeds employees + 5 team leaders from CSV (no password — login is Azure SSO; seed sets `email`, the SSO callback matches on it), seeds `TriviaCard`s with their many-to-many `targets`, and runs an even-distribution pass that writes `assignedLeaderId` on every non-leader player (greedy by-count, alphabetical tiebreak, self-assignment skipped). **Requires three CSVs that are NOT committed (PII)** — see `scripts/README.md`. `scripts/*.csv` is gitignored; never `git add -f`.
- `npm run wipe` — `tsx scripts/wipe.ts` (destructive utility for clearing test data).

The seed does **not** populate `ChatQuestion` or `Penalty`; those are inserted by the migration files (`20260507020000_chat_questions_and_answers`, `20260507030000_penalty_table`) on first `migrate deploy` and are stable across reseeds. Editing the wording belongs in the admin portal, not in the seed.

### Required env (validated at boot by `src/config.ts` via Zod, `process.exit(1)` on failure)

- `DATABASE_URL` — Postgres connection string.
- `SESSION_SECRET` — **exactly 64 hex chars (32 bytes)**. Generate with `openssl rand -hex 32`. Zod enforces the length.
- `FRONTEND_ORIGIN` — full URL of the frontend. Drives CORS allowlist AND the cookie cross-site flag (see below).
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — all three required (no fallback). Used by `lib/cloudinary.ts` for penalty proof + memory uploads.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` (≥ 8 chars) — temporary static admin credentials. Compared with `timingSafeEqual` in `routes/adminAuth.ts`. To be replaced when the role model is decided (Azure OID list / `Employee.isAdmin`); when that lands, swap the body of `requireAdmin` and drop these vars.
- `PORT` — optional, defaults to `4000`.
- `NODE_ENV` — `development` | `production` | `test` (default `development`). Toggles the pino transport in `server.ts`.
- `GAME_END_AT` — optional ISO datetime override (e.g. `2026-05-02T17:00:00+07:00`). Default: today 17:00 Bangkok via a hard-coded `+07:00` offset in `gameClock.gameEndAt()`.
- `GAME_NOW_OVERRIDE` — optional ISO datetime that fakes "now" for testing the time-up flow. `gameClock.gameNow()` reads it.
- `DEV_LOGIN_ENABLED` — strict `"true"` opt-in. Anything else (unset, `"false"`, `"1"`, `"yes"`) is treated as off so a typo can't unlock the bypass. The boot guard refuses to start when `DEV_LOGIN_ENABLED=true && NODE_ENV=production`.
- `SEED_CREATE_TEST_USER` (seed-only) — `"true"` upserts the `TEST-AWARDS` QA fixture and wires it as a target on every TriviaCard so scanning it always yields `match`. Default off.

Azure SSO credentials (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) are read from env in `src/lib/azureClient.ts`; the authority (`organizations`) is hardcoded.

## Server composition (`src/server.ts`)

`buildApp()` registers, in order:

1. CORS (`@fastify/cors`) — origin locked to `env.FRONTEND_ORIGIN`, `credentials: true`.
2. Secure session (`@fastify/secure-session`) — cookie name `jp_sess`, 8-hour `maxAge`. The `crossSiteCookie` flag is `env.FRONTEND_ORIGIN.startsWith('https://')`; when true, the cookie becomes `SameSite=None; Secure` (cross-site prod), otherwise `SameSite=Lax` (local dev). **Don't flip this manually** — the URL scheme of `FRONTEND_ORIGIN` is the toggle.
3. WebSocket plugin (`@fastify/websocket`).
4. Multipart (`@fastify/multipart`) — 8MB `fileSize` cap, 1 file per request. Penalty + memory uploads.
5. Compress (`@fastify/compress`) — gzip + deflate, threshold 1024 bytes. Mostly to shrink the 200-photo memory wall response. Brotli is intentionally disabled to keep CPU cost predictable on a 1-vCPU dyno.
6. Rate limit (`@fastify/rate-limit`) — `global: false` (per-route opt-in), default `300/min`. `routes/adminAuth.ts` overrides with `10/min`, `routes/devAuth.ts` with `30/min`.
7. `onResponse` hook — surfaces 4xx as warn, 5xx as error, and >2s requests as warn. Keeps prod log volume low while still exposing slow paths.
8. Swagger + Swagger UI — UI mounted at `/docs`. WS routes are tagged but not invokable from the UI. The `sessionCookie` security scheme references the `jp_sess` cookie.
9. All HTTP and WS routes nest inside one `app.register(..., { prefix: '/api' })` call. **`adminAuthRoutes` registers BEFORE `adminRoutes`** because `adminRoutes` wires `requireAdmin` as a `preHandler` hook on its plugin instance — applying that hook to the login endpoint itself would lock everyone out. **`devAuthRoutes` only registers when `env.DEV_LOGIN_ENABLED` is true.** WS paths land at `/api/ws/pair/:pairId` and `/api/ws/user`. **`/health` is intentionally outside `/api`** — it's the only route at root.

After `app.ready()`, `startHeartbeat()` from `ws/hub.ts` is kicked off — pings every 30s and reaps sockets that didn't pong.

Listens on `0.0.0.0:${env.PORT}`. Connection / keep-alive timeouts (30s) and request timeout (60s — generous because Cloudinary uploads can take ~10s on slow mobile networks) are set on the Fastify instance to prevent slow-loris connections from pinning sockets.

## HTTP routes (under `/api`)

All routes that read or write per-user state are gated by `requireSession` (`src/middleware/auth.ts`) — replies 401 `{ error: 'unauthenticated' }` when there's no `employeeId` in the session.

### `routes/auth.ts` — Azure SSO + `/me*`
- `GET /auth/azure/login` — generates PKCE pair + random `state`, stashes them on the secure session cookie, redirects to Microsoft for the Authorization Code Flow. Scopes: `openid profile email`. Authority is `organizations` (any work/school account; the Azure Portal app registration is the canonical single-tenant guard).
- `GET /auth/azure/callback` — Microsoft redirects here with `code` + `state`. Validates state, exchanges `code` (with PKCE verifier) via `@azure/msal-node`. **Looks up the employee by `claims.email`** (NOT `azureOid`) — the Microsoft email is the canonical link. On success: clears PKCE state, sets `employeeId` + `issuedAt`, redirects to `${FRONTEND_ORIGIN}/user`. On failure: redirects to `${FRONTEND_ORIGIN}/?error=auth_failed` (or `?error=not_registered` when the SSO email isn't in the roster). The frontend `WelcomePage` reads `?error=` and renders an inline banner.
- `POST /auth/logout` — clears the session, returns 204.
- `GET /me` — returns the session user's `Profile` shape from `employeeCache`.
- `GET /me/progress` — returns `{ cards, triviaStamps, teammateSlots, completedAt, gameEndedAt, leaderClue }`. Reads from the normalized tables (`PlayerCardAssignment`, `TriviaStamp`, `TeammateSlot`), then fans out the four lookups (cards, stamp targets, slot members, assigned leader) in parallel through the in-memory caches. `gameEndedAt` is `gameEndAt().toISOString()` when `isGameEnded()` is true, else `null`. `leaderClue` is the assigned leader's `leaderClue` (or `null` if no leader is assigned).
- `GET /me/pending-penalty` — returns `{ pending: { pairId, role } | null }` for the most recent `Pair` where `kind=TRIVIA`, `triviaPenalty.targetConfirmed=false`, and the user is hunter or target. Powers the `GameShell` auto-redirect into the penalty page on login / hydrate.
- `GET /me/criteria` — returns `{ criteria: string[] }` — clue text of every `TriviaCard` whose `targets` include the current user, in card-id order. Served by `triviaCardCache.getCriteriaClues`. Used by the user profile page to show "what others will look for in you".

### `routes/devAuth.ts` — DEV ONLY (only registered when `DEV_LOGIN_ENABLED=true`)
- `GET /auth/dev/employees` — lightweight roster `(id, name, dept, year, isLeader)` for the welcome page's dev-login picker.
- `POST /auth/dev/login` body `{ employeeId }` — sets `employeeId` + `issuedAt` on the session exactly like the SSO callback. Logs a warn line every time.

### `routes/missions.ts`
- `GET /missions/trivia/start` — first call: snapshots all `TriviaCard`s from cache, copies (`.slice()`!), Fisher–Yates shuffles with `Math.random` (fine for a game, do not use elsewhere), picks `TRIVIA_CARDS_PER_PLAYER = 5`, persists to `PlayerCardAssignment` (delete-then-`createMany`). Subsequent calls return the same 5 in stored `position` order. Returns `{ id, index, clue }` per card — `targetIds` are stripped (solver-side only). On a stale assignment (referenced card was admin-deleted; CASCADE removed the orphan rows), falls through to re-pick.
- `GET /missions/teammate/start` — returns `{ year, leaderClue }`. `leaderClue` is null when no `assignedLeaderId` is set.

### `routes/scans.ts`
- `POST /scans` body `{ scanner_id, scanned_id, card_ref? }`. Asserts `scanner_id === session.employeeId` (else 403 `scanner_mismatch`), then delegates to `processScan`. `NotFoundError` → 404 `{ error: 'not_found', resource }`. `GameEndedError` → 410 `{ error: 'game_ended' }`.

### `routes/penalty.ts`
- `POST /penalty/:pairId/confirm` — **target-only photo upload** (multipart with a `photo` field). Validates the session matches `pair.targetId` (else 403 `not_target`), uploads the buffer to Cloudinary via `uploadImage(buf, 'penalty-proof')`, **upserts the `TriviaPenalty` row** (sets `targetConfirmed=true`, `proofPhotoUrl`; defensively recreates with a fresh `pickRandomPenaltyId()` if the row is somehow missing). Also writes a `MemoryPhoto` row with `contextKind=PENALTY` so the wall can show penalty proofs. Invalidates the memory-wall cache, then broadcasts `penalty.update` on **the pair channel** and on **each side's user channel** (the user-channel frame carries `counterpartId` + `counterpartName`). The photo upload is the entire confirmation step — there is no separate hunter confirm.
- `GET /penalty/:pairId` — returns `{ targetConfirmed, proofPhotoUrl, penalty: { id, text } | null, hunter, target }` where `hunter`/`target` are `{ id, name }` and `penalty` is the `TriviaPenalty.penalty` relation joined.

### `routes/chat.ts`
- `GET /chat/:pairId/question` — returns `{ question }` for the pair's deterministic chat question. Caller must be hunter or target; pair must be `TEAMMATE`. Picked by `pickQuestionForPair` (sha256(`chat-question:${pairId}`) modulo `ChatQuestion` row count, ordered by `index`).
- `POST /chat/:pairId/confirm-teammate` body `{ answer }` — **hunter-only** commit step for the teammate flow (called by `ChatConfirmPage` after the user types the chat-question answer). Verifies `pair.kind === 'TEAMMATE'` and `session === pair.hunterId`, upserts a `ChatAnswer` row (PK = `pairId`, idempotent re-confirm updates rather than 409s), calls `addTeammateSlot`, broadcasts `pair.created` (mode=teammate, role=target) on the target's user channel, returns `{ ok, target }`. **`POST /scans` does not add slots — slot writes happen here.**

### `routes/completion.ts`
- `POST /completion` — idempotent: if `completedAt` is already set, returns it with `alreadyCompleted: true`; otherwise upserts and returns `alreadyCompleted: false`. Invalidates `completion:ranking`. Called from the frontend `CompletedPage` on mount — that is the only caller; nothing else stamps `completedAt`.
- `GET /completion/list` — **TODO: needs admin gating.** Currently `requireSession`-only.
- `GET /completion/ranking` — **public** (no `requireSession`). Returns `{ done, pending }` for the projector display at `/ranking`. Each row carries `done`/`total` quest progress (5 trivia + 5 non-leader teammate = 10) and `updatedAt` (from `PlayerProgress.updatedAt`) for "last activity" relative time. Counted via `_count: { triviaStamps, teammateSlots: { where: { member: { isLeader: false } } } }` — leader slots are excluded by JOIN. Wrapped in `ttlCached('completion:ranking', 3000, ...)` and sets `Cache-Control: public, max-age=3, stale-while-revalidate=10`. Pending list ordering: active players (`done > 0`) first by `done desc`, then `updatedAt desc`; players with zero progress fall to the bottom alphabetical-by-name (so the projector starts as a clean A-Z roster and lights up top-down).
- `POST /completion/finalize-all` — **does NOT mutate `completedAt`**. It only verifies `isGameEnded()` and broadcasts `game.ended` on every user WS channel so connected clients redirect to `/time-up`. Returns 409 `not_yet_ended` if the clock hasn't passed game-end. Currently `requireSession`-only — admin gating TODO. (See also `POST /admin/game/end-now` for the admin-gated copy.)

### `routes/memories.ts`
- `POST /memories` — multipart upload from a logged-in user. Fields: `photo` (image), `contextKind` ∈ {`trivia`, `teammate`}, `contextId` (cardId for trivia, pairId for teammate), `counterpartId` (the employee in the photo). Uploads to Cloudinary in the `memories` folder, persists a `MemoryPhoto` row with `contextKind` mapped to the `MemoryContext` enum (`TRIVIA` | `TEAMMATE`), invalidates the wall cache. **`PENALTY` is written exclusively from `routes/penalty.ts`**, never via this route — the wire-format mapping rejects it.
- `GET /memories/wall` — **public** projector feed of up to 200 most-recent rows. `kind` is derived: `penalty` when `contextKind === MemoryContext.PENALTY`, `memory` otherwise. 3s TTL cache + same `Cache-Control` as `/completion/ranking`. The cache key is exported as `MEMORIES_WALL_CACHE` so `routes/penalty.ts` and `routes/admin.ts` can `invalidate(...)` it after writes / deletes.

### `routes/adminAuth.ts` — temporary static-credential admin gate
- `POST /admin/auth/login` body `{ username, password }` — `timingSafeEqual` (with length-mismatch handling) against `env.ADMIN_USERNAME` / `env.ADMIN_PASSWORD`. On success sets `isAdmin=true` + `adminLoggedAt` on the session. Rate-limited 10/min. **Independent from `employeeId`** — the same `jp_sess` cookie can hold both flags.
- `POST /admin/auth/logout` — clears the `isAdmin` flag (leaves `employeeId` alone).
- `GET /admin/auth/me` — returns `{ isAdmin: boolean }`. Used by `AdminShell` to bounce to `/admin/login` when the flag is false.

### `routes/admin.ts` — admin portal endpoints (every route gated by `requireAdmin`)
The plugin wires `app.addHook('preHandler', requireAdmin)` once at the top so every route on the instance is gated. Today `requireAdmin` checks `session.isAdmin === true`; when the role model lands, swap the body and the gate goes live across every route here without per-route changes. Response schemas are intentionally loose (`additionalProperties: true`) so we can reshape rows without churning the route file. Strict input schemas only on params + create/update bodies.

- **Dashboard** — `GET /admin/dashboard` — aggregate counts (total / finished / playing / not_started / activePairs / scansToday / memoriesUploaded / completedQuests / totalQuests), `gameEndAt` + `isGameEnded`, plus 6 most recent scans and up to 8 active trivia pairs (joined with employees + `triviaPenalty.penalty`). "Active pairs" = `Pair.triviaPenalty.is.targetConfirmed = false` — teammate pairs never have a `TriviaPenalty` row so they correctly don't appear.
- **Players** — `GET /admin/players?q&status` lists every employee with their progress (server computes `triviaCount` / `memberCount` / `hasLeader` / `pct`). `GET /admin/players/:id` returns the full detail (assigned cards with `targetIds`, stamps with stamper employee, slots, assigned leader). `POST/DELETE /admin/players/:id/complete`, `DELETE /admin/players/:id/progress` (clears stamps + slots + completedAt, **keeps** assignedCards / Leader). `POST /admin/players/:id/stamp` + `DELETE .../:cardId` force-grant / revoke a stamp (per-row, no advisory lock needed). `POST /admin/players/:id/teammate` calls `addTeammateSlotAdmin` — bypasses the 5+1 cap **by design** (still holds the per-player advisory lock and dedups by id). `DELETE .../:employeeId` removes a slot (idempotent — `P2025` is treated as a successful no-op). `PATCH .../assigned-leader` body `{ leaderId | null }` (validates `leader.isLeader === true`). `POST .../assigned-cards/reroll` clears `PlayerCardAssignment` + `TriviaStamp` so the next `/missions/trivia/start` picks a fresh 5.
- **Employees** — `GET /admin/employees?q&role`, plus `POST` / `PATCH` / `DELETE` CRUD. Mutations call `invalidateEmployeeCache()`.
- **Trivia** — `GET /admin/trivia` returns cards + targets + `assignedToCount` + `stampedCount`. `POST` / `PATCH` / `DELETE` CRUD. **`body.index` is accepted but ignored** — the display number is derived from the id (`deriveCardIndex`, `/(\d+)$/`). Updates use `targets: { set: [...] }` to replace the M2M list wholesale. Mutations call `invalidateTriviaCardCache()`. Delete relies on `ON DELETE CASCADE` on `PlayerCardAssignment.cardId` + `TriviaStamp.cardId` to clean up orphans.
- **Pairs** — `GET /admin/pairs?status&kind` (status `pending`/`confirmed` only meaningful for trivia — applies a `triviaPenalty: { is: { targetConfirmed: ... } }` relation filter that implicitly restricts to TRIVIA). `POST /admin/pairs/:id/force-clear` flips `triviaPenalty.targetConfirmed=true` so the hunter is freed from the auto-redirect; rejects with 400 `no_penalty_round` for teammate pairs. Same broadcast pattern as `POST /penalty/:pairId/confirm` (pair channel + both user channels) — `proofPhotoUrl` stays null and the frontend treats it as "round closed without proof".
- **Scans** — `GET /admin/scans?q&mode&outcome&limit&cursor` cursor-paginated audit log (`take: limit + 1`, returns `nextCursor`).
- **Memories** — `GET /admin/memories?kind&limit` (`kind=penalty` → `contextKind=PENALTY`; `kind=memory` → `NOT PENALTY`). `DELETE /admin/memories/:id` best-effort destroys the Cloudinary asset (logs and continues if it fails — the row is the source of truth) then deletes the DB row + invalidates the wall cache.
- **Game lifecycle** — `GET /admin/game` returns `{ gameEndAt, serverNow, isEnded }`. `POST /admin/game/end-now` is the admin-gated `finalize-all` — broadcasts `game.ended` to every user channel, returns 409 `not_yet_ended` if the clock hasn't passed.

## Domain logic (`src/domain/scan.ts`)

`processScan` is **the** core piece of business logic. The **nine-variant** `ScanOutcome` is mirrored in three places (`shared/types.ts`, the local `ScanOutcome` type at the top of `scan.ts`, and `frontend/src/types/game.ts`); when adding/renaming a variant change all three plus the scanner's branching in `frontend/src/features/scanner/ScannerPage.tsx`.

Cohort labelling for the teammate flow uses `inSameYearGroup`: `SENIOR_COHORT_CUTOFF = 2023` — pre-2023 hires are one cohort, 2023+ split by exact year. Mirror this on the frontend (`formatYearGroup` in `gameStore.ts` shares the cutoff constant).

Scanner + target + card lookups all flow through `getEmployeesByIds` and `getTriviaCard` (60s in-memory caches). Only the trivia transactions hit the DB inside the request. `processScan` opens with `if (isGameEnded()) throw new GameEndedError()` so submissions stop the moment the clock crosses game-end.

**Trivia branch (when `cardRef` is provided):**
- `match` — the card's `targets` include `scannedId`. Wrapped in a transaction that creates the `Scan(MATCH)`, `ensurePlayerProgress`, upserts `TriviaStamp(playerId, cardId)` (PK is `(playerId, cardId)`, so concurrent matches on different cards no longer share a row and no per-scanner advisory lock is needed), and bumps `PlayerProgress.updatedAt` so the projector ranking sort sees activity. Broadcasts `trivia.found` (with the card's `clue`) to the *target's* user channel.
- `mismatch` — wrong target. **`pickRandomPenaltyId()` rolls before the transaction** (60s in-memory `penaltyCache.ts`, no DB round-trip on the hot path). Inside the transaction: read existing pair + its `triviaPenalty` side-row, decide `isNewRound`, upsert. **New round when** (a) no existing pair, (b) `existing.triviaPenalty?.targetConfirmed === true` (prior round closed), or (c) `existing.hunterId !== scannerId` (scan direction flipped — A scanned B earlier today, now B scans A; the latest mismatcher must become hunter). On a new round we update `Pair.hunterId/targetId` to the current scanner/target and **upsert `TriviaPenalty`** with `targetConfirmed=false`, `proofPhotoUrl=null`, `penaltyId=newPenaltyId`. Always writes `Scan(MISMATCH, TRIVIA)` with `pairId`. **Always re-broadcasts** `pair.created` on both sides — even on the same-round case — so a target who missed the original frame (hidden tab, mobile data blip) still gets pulled into the penalty page via `useUserSocket` → `setPenalty(...)` → `GameShell` redirect.

**Teammate branch (no `cardRef`):**
- `wrong_year` — both scanner and target are non-leaders and `inSameYearGroup(target.year, scanner.year)` is false. Logs a `Scan(MISMATCH, TEAMMATE)` with **no `pairId`**. No penalty pair, no broadcast.
- `wrong_leader` — target is a leader, the scanner has an `assignedLeaderId`, and target isn't that leader. **No audit row, no broadcast** — dead-end with toast feedback only.
- `leader_clash` — scanner is themselves a leader and the target is also a leader. Leader-vs-leader recruiting is forbidden. No audit row.
- `already_added` — scanner's `teammateSlots` already contains the target id. **No row written** (audit silence is intentional — same-day re-scans of an already-added teammate would otherwise spam the table).
- `leader_full` — target is a leader, scanner already has a leader. Same: no row, no broadcast.
- `teammate_full` — target is not a leader, scanner has 5 non-leaders already. Same: no row, no broadcast.
- `chat` — passes all the above. Upserts a teammate `Pair`, writes `Scan(MATCH, TEAMMATE)`. **Slot addition + target notification are deferred to `POST /chat/:pairId/confirm-teammate`** — `processScan` does not call `addTeammateSlot` itself and does not broadcast. The HTTP response carries `pair_id`; the frontend goes to `/chat/:pairId`, the user submits the chat-question answer, and that's when `addTeammateSlot` and the `pair.created` broadcast fire.

The 5+1 teammate slot cap (5 non-leader members + 1 optional leader, max 6 total) is enforced **in code, not the schema**, in two places:
1. The pre-write checks in `processScan` that emit `leader_full` / `teammate_full`.
2. `addTeammateSlot`'s defensive guards inside a `pg_advisory_xact_lock(hashtext(playerId))` transaction (`slots.length >= 6`, dedup by id, leader-already-present, non-leader-already-5). The cap check uses a JOIN on `Employee.isLeader` so it sees the *current* split, not a stale snapshot. Preserve both — without the lock, a race could exceed the cap.

`addTeammateSlotAdmin` (called from the admin force-add route) **bypasses the cap by design** but still holds the per-player advisory lock and still dedups by id. Keep it separate from `addTeammateSlot` so the scan path cannot accidentally pass a `force` flag and exceed the cap.

**Leader is "extra" and does NOT count toward completion.** Frontend `selectIsComplete` (`gameStore.ts`) is `triviaStampCount + nonLeaderSlotCount >= 10`. The leader slot is bonus — a player who has 5 trivia + 4 members + 1 leader has 6 `TeammateSlot` rows but only 9 toward completion. Mirror this in any backend code that derives completion progress (`/completion/ranking` and `/admin/dashboard` already do, via `_count: { teammateSlots: { where: { member: { isLeader: false } } } }`).

`Pair.id` (see `domain/pairId.ts`):
- **TRIVIA: symmetric** — sorted ids → one shared penalty pair per `(A, B)` per UTC day.
- **TEAMMATE: directional** — `[scannerId, scannedId]` is NOT sorted, so each scanner gets their own pair; both sides can independently add each other to their own teams.
- `dayBucket` is the **UTC** date `YYYY-MM-DD` from `gameNow().toISOString().slice(0,10)` — pairs roll over at UTC midnight, not local. Switching to local time silently double-bills users near midnight.

`domain/chatQuestions.ts` — chat questions are stored in the `ChatQuestion` table. The module keeps a 60s in-memory cache mirroring `triviaCardCache`. `pickQuestionForPair(pairId)` is deterministic via sha256: `parseInt(hash[0..8], 16) % rowCount`, indexed into the rows ordered by `ChatQuestion.index`. Both sides of the pair (and reload-the-page) see the same question. **`index` must stay stable** — changing it would re-route an in-flight pair to a different question.

## Caches (`src/lib/`)

- `employeeCache.ts` — full `Employee` table loaded into a `Map`, 60s TTL, single in-flight load (concurrent callers share the same DB hit). Used by every route that needs employee lookups. The Azure SSO callback hits Prisma directly (lookup by `email`). The TTL means a re-seed will be reflected within 60s without bouncing the server.
- `triviaCardCache.ts` — same pattern for `TriviaCard` rows + their `targetIds`. Exposes `getTriviaCard`, `getTriviaCardsByIds`, `getAllTriviaCardsOrdered`, `getCriteriaClues(employeeId)`, `deriveCardIndex(id)`. The ordered snapshot is shared/frozen — callers that mutate (e.g., shuffle in `/missions/trivia/start`) MUST `.slice()` first. `deriveCardIndex` extracts a 1-based number from the id's trailing digits (`CARD-01` → 1); ids without trailing digits map to 0.
- `penaltyCache.ts` — same pattern for `Penalty`. `pickRandomPenaltyId()` returns a uniformly-random id, or `null` when the table is empty (lets the mismatch path create a Pair without a penalty rather than crash). Invalidate via `invalidatePenaltyCache()` (called from admin routes when they mutate the table).
- `ttlCache.ts` — generic per-key TTL store with single in-flight per key. Used for `completion:ranking` (3s) and `memories:wall` (3s). `invalidate(key)` is called from the writes that change those views (`POST /completion`, `POST /memories`, `POST /penalty/:pairId/confirm`, plus admin mutations).
- `cloudinary.ts` — wraps `cloudinary.uploader.upload_stream` with a semaphore (`MAX_CONCURRENT_UPLOADS = 8`) so a burst of penalty confirms can't spike memory or hammer Cloudinary's rate limit. Excess uploads queue FIFO.
- `gameClock.ts` — `gameNow()` (honors `GAME_NOW_OVERRIDE`), `gameEndAt()` (honors `GAME_END_AT`; default = today 17:00 Bangkok via a hard-coded `+07:00` offset), `isGameEnded()`.

## WebSocket hub (`src/ws/hub.ts`)

Two channels, both `Map<string, Set<WebSocket>>` in process memory:

- **Pair channel** — keyed by `pairId`. Used while a user is on the penalty page (`FailPenaltyPage`). `PairWsEvent = penalty.update` (carries `targetConfirmed` + `proofPhotoUrl`). No inbound frames — the WS handler authorizes (checks `pair.hunterId === session || pair.targetId === session`, closes 1008 `forbidden` otherwise) and subscribes.
- **User channel** — keyed by `employeeId`. Used to push notifications wherever the user is. `UserWsEvent = pair.created | trivia.found | penalty.update | game.ended`. These frames are **richer** than their pair-channel cousins — they carry `pairId`, `role`, `counterpartId` / `counterpartName`, plus `cardClue` on `trivia.found` and `proofPhotoUrl` on `penalty.update`, so the frontend can render and route without a refetch.
- `broadcastGameEnded(event)` fans `game.ended` across **every** user channel.

Heartbeat: `startHeartbeat()` pings every 30s and `terminate()`s any socket that didn't pong since the last tick. `trackSocket(ws)` is called by both WS route handlers when a connection lands; the WeakMap-backed alive flag flips to `false` on each tick, then back to `true` when the pong arrives. Reaps stale entries from both channel maps in the same loop so we don't leak fds. A burst of reaps is logged as a warn — usually a network-side blip (wifi outage, ingress restart) rather than the usual mobile-drop trickle.

When extending event kinds, keep four places in sync:
1. `PairWsEvent` / `UserWsEvent` here.
2. `frontend/src/lib/useUserSocket.ts` (inlines its own `UserWsEvent` type — must match this file).
3. `frontend/src/lib/useWebSocket.ts` (mirrors `PairWsEvent`).
4. `shared/types.ts` (the `WsEvent` partial mirror — only the subset the frontend imports as a value type).

Most user-channel events (`trivia.found`, teammate `pair.created`, `penalty.update`) are currently no-ops on the frontend — the notification UI that consumed them was removed. The two events the frontend still acts on are `game.ended` (drives the `/time-up` redirect) and trivia `pair.created` for `role='target'` (drives the penalty-page redirect via `setPenalty`). Adding a new event kind that needs UI is fine, but the type still needs to be declared in all four places so the discriminated union stays exhaustive.

**Hub state is in-process and not durable.** Doesn't survive a restart, doesn't work across multiple replicas — if you scale beyond one Railway dyno you need a backplane (Redis pub/sub, NATS, etc.). All broadcast functions are silent no-ops when there's no subscriber; never assume delivery.

## Prisma data model — gotchas not in the schema

- `Employee` — `id` is the canonical id. `email` is the SSO link (auto-matched on first sign-in). `azureOid` is on the schema but **not used by the callback** at runtime — the callback matches by email only; `azureOid` exists for future role-modeling. The pre-SSO login columns (`username`, `passwordHash`) and `awards` were dropped in `20260507000000_normalize_progress_drop_dead_login` and `20260507040000_drop_employee_awards`. `nickname` and `position` are display-only. `leaderClue` is the per-leader hint shown on the teammate intro page for everyone assigned to that leader.
- `TriviaCard` — `targets` is **many-to-many** via the implicit join table `_TriviaCardTargets` (relation name `TriviaCardTargets`). There is no `index` column — the display number is derived from the id at runtime (`deriveCardIndex`). Do not reintroduce a 1:1 `targetId`.
- `Pair` — pure "two players paired up on this kind on this UTC day" record. No penalty / confirmation columns anymore. Two 1:1 side-tables hang off it: `ChatAnswer` (TEAMMATE-only) and `TriviaPenalty` (TRIVIA-only). Indexed `(hunterId, kind, createdAt desc)` and `(targetId, kind, createdAt desc)` to cover the pending-penalty lookup.
- `TriviaPenalty` — TRIVIA-only side-table introduced in `20260507050000_split_trivia_penalty`. Fields: `pairId` (PK), `penaltyId` (nullable — empty Penalty pool / admin deleting a penalty mid-event keeps the round alive with no penalty text), `targetConfirmed`, `proofPhotoUrl`. Created on each new trivia mismatch round; updated by `POST /penalty/:pairId/confirm`. Cascade on Pair delete; SET NULL on Penalty delete.
- `Scan` — append-only audit log. `outcome` is the Prisma enum `ScanOutcome { MATCH, MISMATCH }` — only two values. The nine-variant TS `ScanOutcome` lives in code, not the DB. Audit writes intentionally differ between outcomes (no row for `already_added` / `leader_full` / `teammate_full` / `wrong_leader` / `leader_clash`).
- `MemoryPhoto` — `contextKind` is the `MemoryContext` enum (`TRIVIA` | `TEAMMATE` | `PENALTY`). Written from two routes: `POST /memories` (`TRIVIA` | `TEAMMATE` only) and `POST /penalty/:pairId/confirm` (`PENALTY`). The wall feed normalizes to a 2-value `kind` (`memory` | `penalty`) for the frontend.
- `PlayerProgress` — JSON columns are gone. The previous `triviaStamps` / `teammateSlots` / `assignedCardIds` JSON were normalized into proper relational tables in `20260507000000_normalize_progress_drop_dead_login`:
  - `TriviaStamp` — PK `(playerId, cardId)`. Per-row inserts mean concurrent matches on different cards no longer race on a JSON blob; no per-scanner advisory lock needed for stamps.
  - `TeammateSlot` — PK `(playerId, memberId)`. The 5+1 cap is still in code.
  - `PlayerCardAssignment` — PK `(playerId, cardId)`, plus `position` to preserve the original shuffle order.
  - `assignedLeaderId: String?` — written by the seed's even-distribution pass. Drives `wrong_leader` and the `leaderClue` returned by `/missions/teammate/start` and `/me/progress`. Leader-players have `null` here.
  - `completedAt: DateTime?` — set ONLY by `POST /completion` (or admin overrides). Game-end / time-up does NOT touch this — that signal lives on `gameClock` (`isGameEnded()` / `gameEndAt()`) and is broadcast as `game.ended`.
  - `updatedAt: DateTime @updatedAt` — bumps whenever any field on the row changes. The trivia match path bumps it explicitly (the upsert wouldn't otherwise touch the parent row). Read by `/completion/ranking` for the projector's "last activity" sort.
- `ChatQuestion` — fixed pool of "get to know each other" prompts seeded by migration `20260507020000_chat_questions_and_answers`. `index` is what `pickQuestionForPair` hashes against — must stay stable.
- `ChatAnswer` — written by `POST /chat/:pairId/confirm-teammate`. PK = `pairId` (one pair = one question = one answer; idempotent on re-confirm). If a "redo" path is ever added, switch to a surrogate id + `(pairId, createdAt)` index.
- `Penalty` — fixed pool of penalty texts seeded by migration `20260507030000_penalty_table`. `processScan` rolls one at random per new mismatch round; the chosen id lands on `TriviaPenalty.penaltyId` so both sides see the same penalty across reloads.

## Path alias + ESM import quirk

`tsconfig.json` declares `paths: { "@/*": ["./src/*"] }` and is `module: ESNext`, `moduleResolution: bundler`. `tsx` honors the alias at dev time; for the production build, `tsc` does NOT rewrite the alias — `tsc-alias` runs as a second build step (`npm run build`) and rewrites the emitted `.js`. **All cross-module imports use `@/...`** with a `.js` extension on the specifier — e.g. `import { prisma } from '@/db/prisma.js'`. The `.js` is required because the project is ESM and Node resolves the emitted `.js`, not the source `.ts`. **Do not strip the `.js`** even though the file on disk is `.ts`.

Inside the `domain/` and `ws/` folders, relative imports (`./pairId.js`, `./hub.js`) use the same `.js`-on-source rule.

## Things that are easy to break

- **Adding a route** — register it inside the `/api` nested register block in `server.ts`. Otherwise it ends up at root and CORS / cookies will silently misbehave.
- **Admin route order** — `adminAuthRoutes` MUST register BEFORE `adminRoutes`, or the `requireAdmin` preHandler hook gates the admin login endpoint itself and locks everyone out.
- **Editing `processScan`** — the nine outcomes are wired through three TS files plus the frontend scanner. Audit-log writes intentionally differ between outcomes. Don't "fix" that.
- **Penalty flow direction** — there is no hunter confirm step. The hunter cannot escape an unconfirmed pair (`GameShell` redirects them back to `/result/fail/:pairId`); the target ends the round by uploading a photo. If you re-introduce a two-sided confirmation, you'll need to add a hunter-side flag back to `TriviaPenalty` and update the `pendingPenalty` query.
- **Slot writes on the scan path** — `processScan` writes the `Pair` and audit row but does NOT call `addTeammateSlot`. That's the chat-confirm route's job. Don't move it back to scan or you'll skip the chat question step.
- **Pair-id day bucket** — switching to local time silently double-bills users near midnight. Keep it UTC.
- **TEAMMATE pair direction** — `deterministicPairId` deliberately does NOT sort the ids for TEAMMATE so each scanner has their own pair. Don't "normalize" this.
- **Mismatch re-broadcast** — the trivia mismatch path re-broadcasts `pair.created` even on the same-round case. This is intentional: a target who was on a hidden tab or had a network blip when the original frame went out would otherwise never get pulled into the penalty page. Don't gate the broadcast behind `isNewRound`.
- **`prisma migrate deploy` in `npm start`** — preserves data and applies committed migrations. The historical `db push --accept-data-loss` shape of this command is unsafe and should not come back.
- **Cache invalidation** — `/completion/ranking` and `/memories/wall` are TTL-cached. Writes that change those views (`POST /completion`, `POST /memories`, `POST /penalty/:pairId/confirm`, plus admin mutations) must call `invalidate(key)` afterward. Without it the projector lags by up to 3s.
- **Session cookie cross-site flag** — driven only by whether `FRONTEND_ORIGIN` starts with `https://`. Plain `http://` in prod will get the cookie rejected by browsers even though CORS allows the origin.
- **Dev login** — `DEV_LOGIN_ENABLED=true` in production refuses to boot. The strict `=== 'true'` check intentionally rejects `"1"`, `"yes"`, etc. Don't relax this.
- **Frontend ownership** — the user often hand-edits frontend files. On cross-stack work, ask before touching `frontend/src/**`.
