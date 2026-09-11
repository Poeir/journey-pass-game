# Admin Portal — Backend Requirements

This is the companion doc for the `/admin/*` UI in `frontend/src/features/admin/`.
The pages here are a UI prototype using mock data from `mockData.ts`. To wire it
up, build the endpoints below. Everything is currently **un-gated** in the UI;
adding the auth layer is task 0.

## 0. Auth gating (precondition for everything else)

Currently no role exists. Add one of:
- `Employee.isAdmin: Boolean @default(false)` in `prisma/schema.prisma`, or
- A separate `AdminUser` table keyed by `azureOid`, or
- A simple `ADMIN_AZURE_OIDS` env list (cheapest, but rebuilds to change).

Then add `requireAdmin` middleware next to `requireSession` in
`backend/src/middleware/auth.ts` — replies `403 { error: 'forbidden' }` when
the session user isn't an admin. Apply to every route under `/api/admin/*`.

The seed (`backend/scripts/seed.ts`) should mark a known set of admins so the
first deploy isn't bricked.

---

## Routes per page

All routes are prefixed with `/api/admin/`.

### Dashboard — `/admin`

- `GET /admin/dashboard` → aggregate stats:
  ```
  {
    totalPlayers, finished, playing, notStarted,
    activePairs, scansToday, memoriesUploaded,
    totalQuests, completedQuests,
    gameEndAt, isGameEnded
  }
  ```
- `GET /admin/activity?limit=20` → most recent N scans, joined with player names.
- TTL-cache 3s (reuse `lib/ttlCache.ts`); invalidate on `POST /scans`,
  `POST /completion`, `POST /memories`, `POST /penalty/:pairId/confirm`.

### Players list — `/admin/players`

- `GET /admin/players?q=&status=` → paginated rows of every employee with their
  `PlayerProgress`. Server should compute `triviaCount`, `memberCount`,
  `hasLeader`, `pct` so the UI doesn't redo the math.
- `GET /admin/players/export.csv` → streamed CSV (rankings + slot details for
  post-event reporting).

### Player detail — `/admin/players/:id`

- `GET /admin/players/:id` → full progress: assigned cards (with clue + targets),
  trivia stamps (with stamper employee), teammate slots, assigned leader,
  completedAt, updatedAt.
- `POST /admin/players/:id/stamp` body `{ cardId, targetId }` → force-grant a
  trivia stamp. Server must respect the same `pg_advisory_xact_lock` as the
  scan path (`domain/scan.ts`) — same lock key.
- `DELETE /admin/players/:id/stamp/:cardId` → revoke.
- `POST /admin/players/:id/teammate` body `{ employeeId }` → bypass the cap
  checks (admin override). Re-uses `addTeammateSlot` but with a force flag, or
  a separate path that skips guards while still holding the player lock.
- `DELETE /admin/players/:id/teammate/:employeeId` → remove from slots.
- `PATCH /admin/players/:id/assigned-leader` body `{ leaderId }` → update
  `assignedLeaderId`.
- `POST /admin/players/:id/assigned-cards/reroll` → clear and re-pick 5.
- `POST /admin/players/:id/complete` → set `completedAt = now()`. Idempotent.
- `DELETE /admin/players/:id/complete` → null out `completedAt` (rare rollback).
- `DELETE /admin/players/:id/progress` → wipe stamps + slots + completedAt
  (keeps assigned cards/leader). Bumps `updatedAt`.

All of the above must invalidate `completion:ranking` cache via `invalidate()`.

### Employees — `/admin/employees`

- `GET /admin/employees?q=&role=`
- `POST /admin/employees` create.
- `PATCH /admin/employees/:id` update name/dept/year/birthMonth/email/awards/
  isLeader/leaderClue/nickname/position.
- `DELETE /admin/employees/:id` — must cascade-delete `PlayerProgress` (already
  on the schema) and decide what to do with their `Scan`/`Pair`/`MemoryPhoto`
  rows. Probably just leave audit rows pointing at a deleted id rather than
  cascading them. Adjust the FK relations in `schema.prisma` accordingly.
- `POST /admin/employees/import` (multipart) → CSV upload. Parses the same
  schema as `scripts/seed.ts`. Optional `redistributeLeaders=true` flag re-runs
  the even-distribution pass after import.
- After any write: `invalidateEmployeeCache()` so the 60s TTL in
  `lib/employeeCache.ts` doesn't serve stale rows.

### Trivia cards — `/admin/trivia`

- `GET /admin/trivia` → all cards with `targets`, `assignedToCount`,
  `stampedCount` derived from `PlayerProgress.assignedCardIds` and
  `triviaStamps` keys.
- `POST /admin/trivia` create.
- `PATCH /admin/trivia/:id` edit clue/index.
- `PUT /admin/trivia/:id/targets` body `{ targetIds: string[] }` — replace
  the many-to-many. Removing a target does **not** retroactively un-stamp
  anyone (call this out in the UI confirm dialog).
- `DELETE /admin/trivia/:id` — must also remove the cardId from any player's
  `assignedCardIds` JSON column (or the missions endpoint will 404 on next
  load).
- After any write: `invalidateTriviaCardCache()`.

### Pairs — `/admin/pairs`

- `GET /admin/pairs?status=&kind=` → list with `hunter`/`target` joined.
- `GET /admin/pairs/:id` → full record + proof URL.
- `POST /admin/pairs/:id/force-clear` → sets `targetConfirmed=true`,
  `proofPhotoUrl` to a placeholder, broadcasts `penalty.update` on the pair
  channel **and** both user channels. Frees the hunter from the auto-redirect.
- `DELETE /admin/pairs/:id` → hard-delete (rare, for accidentally-created
  pairs). Should keep the `Scan` audit row alive.

### Scans — `/admin/scans`

- `GET /admin/scans?q=&mode=&outcome=&from=&to=&cursor=` → paginated. Use a
  cursor (`createdAt + id`) — the table will get big. Default 50/page.
- `GET /admin/scans/export.csv?...same filters...` → stream.

### Memories — `/admin/memories`

- `GET /admin/memories?kind=&cursor=` → paginated. Reuse the public
  `/memories/wall` shape but include uploader/counterpart full names + ids.
- `DELETE /admin/memories/:id` → must call Cloudinary `uploader.destroy` for
  the asset (parse `public_id` out of the URL) **before** deleting the DB row.
  Then `invalidate('memories:wall')`.
- `POST /admin/memories/:id/hide` → soft-hide (add a `hiddenAt: DateTime?`
  column on `MemoryPhoto`; the public wall filters out non-null `hiddenAt`).

### Game lifecycle — `/admin/game`

Promoting hardcoded constants to a DB-backed config:

- New `GameConfig` table (single row, key `current`):
  ```
  model GameConfig {
    id           String   @id @default("current")
    gameEndAt    DateTime
    nowOverride  DateTime?
    triviaCardsPerPlayer Int @default(5)
    teammateMemberCap    Int @default(5)
    leaderSlotEnabled    Boolean @default(true)
    penaltyList  String[] @default(["..."])
    updatedAt    DateTime @updatedAt
  }
  ```
- `lib/gameClock.ts` reads from this row (TTL-cached) instead of env. Env
  values stay as boot-time fallbacks for first deploy.
- `GET /admin/game` → returns the row + `serverNow`.
- `PATCH /admin/game` body `{ gameEndAt?, nowOverride?, ... }` → updates the
  row. Invalidate the gameClock cache.
- `POST /admin/game/end-now` → wraps the existing `POST /completion/finalize-all`
  but with admin gating (the existing route's TODO).
- `POST /admin/game/announce` body `{ message, severity }` → broadcasts a new
  `announcement` WS event on every user channel. Requires a corresponding
  frontend banner subscriber.
- `POST /admin/game/reset` body `{ confirm: 'RESET' }` → wipes Scan, Pair,
  MemoryPhoto, PlayerProgress in a transaction. Keeps Employee + TriviaCard.
  Also clears any Cloudinary assets in the `memories` and `penalty-proof`
  folders (or skip and rely on their TTL).
- `POST /admin/game/redistribute-leaders` → re-runs the seed's even-
  distribution pass against current employees. Returns counts per leader.

### Settings — `/admin/settings`

- `GET /admin/settings` → same row as `GET /admin/game` minus the clock fields
  (or just one combined endpoint).
- `PATCH /admin/settings` → updates trivia/teammate counts + penalty list.
  Frontend constants in `FailPenaltyPage.tsx` (`PENALTY_COUNT`) and the
  trivia page should read from `/me/progress` or a new `/config/public`
  endpoint instead of hardcoded values.

---

## Cross-cutting

- **Cache invalidation** — Every admin write that changes employee/trivia/
  ranking/memory shape must call the matching `invalidate*` function. See the
  list in `backend/CLAUDE.md` "Things that are easy to break".
- **WebSocket fanout** — Force-clearing a pair, ending the game, sending an
  announcement, and resetting all need to broadcast on the relevant channel
  so connected clients update without a refetch. Hub state is in-process
  (single replica) — if you scale out, stand up a Redis pub/sub backplane
  before relying on these.
- **Audit trail** — Consider an `AdminAction` table for everything an admin
  changes (`actorId`, `kind`, `targetId`, `payload`, `createdAt`) so you can
  answer "who edited Player X at Y time" after the event.
- **Rate limit** — admin routes can keep the default 300/min. Imports and CSV
  exports should be excluded.

## What's NOT in this prototype

- Login flow / role assignment screen — needs design once you decide on the
  role model. Today the AdminShell exposes a fake user pill.
- Real photo previews for memories/penalty proofs — placeholders only because
  there are no Cloudinary URLs in `mockData.ts`.
- Pagination + virtual scrolling on the scan log — fine for the prototype, but
  tens-of-thousands of rows in production need cursor pagination + a list
  virtualization library.
- The "Send announcement" feature requires a new WS event kind plus a frontend
  banner that subscribes to it. Keep it out of v1 unless requested.
