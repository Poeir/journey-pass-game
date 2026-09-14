# 5.5 Journey Pass

A mobile-played game for Company Day: use your phone camera to scan other employees' QR codes to complete quests before the game ends.

Each player logs in on their own phone, gets their own QR code (for others to scan), and opens the camera to scan other players' QR codes to collect stamps across 2 missions — 5 trivia stamps + 5 teammate slots = 10 quests total to complete.

## Overview (What & Why)

This project is a monorepo consisting of:

| Part | Description |
|------|-------------|
| `frontend/` | The mobile-first PWA players use to play the game (open camera / scan / view stamps) |
| `backend/` | API + WebSocket hub + all game-rule processing |
| `shared/types.ts` | Domain types imported and shared by both sides (Employee, ScanOutcome, WsEvent) |

## In-game missions (2 missions)

**Trivia** — Players are given 5 trivia cards randomly assigned by the system (the ids are locked into `assignedCardIds` the first time the mission is opened; opening it again returns the same cards). Each card has a clue describing one employee (or more — target relations are many-to-many). The player must guess who matches the clue, then scan that person's QR code.
- Correct guess → `match` → get a stamp, the guessed person gets a WebSocket notification
- Wrong guess → `mismatch` → creates a penalty pair on both sides; both must go to the penalty page (the target uploads a proof photo) before they can scan again

**Teammate** — Find 5 friends in the same cohort + 1 leader assigned by the system (extra/bonus) to join your team.
- Cohort: people hired before 2022 are grouped into one cohort; from 2022 onward, cohorts are split by year (see `inSameYearGroup` in `domain/scan.ts`)
- Scanning someone from a different cohort, where neither is a leader → `wrong_year`
- Each player is seeded with one assigned leader (`assignedLeaderId`, distributed via greedy least-assigned) — scanning a leader who isn't your assigned one → `wrong_leader`; being a leader yourself and scanning another leader → `leader_clash`
- A successful scan produces a `chat` outcome → the system creates a teammate `Pair`, but the slot is **not** added yet — you must go to `/chat/:pairId`, answer the question, then `POST /chat/:pairId/confirm-teammate` before the slot is recorded
- Leaders count as extra and are not counted in the 10 required quests (5 trivia stamps + 5 non-leader teammate slots = 10)

## Public projector screens (no login required)

- `/memory` — Memory Wall showing photos players took on success
- `/ranking` — Shows who has finished / is still playing + how many quests remain, polls every 10s

## Game clock & time-up

There's a game-end deadline (`GAME_END_AT`, default = today at 17:00 Asia/Bangkok). When time runs out, the server broadcasts `game.ended` to every client, redirecting them to `/time-up`. Players who haven't completed all 10 quests will not have `completedAt` marked.

## Tech Stack

### Backend (`backend/`)

- Node.js 20 LTS+ (ESM, `type: module`)
- Fastify 4 + plugins: `@fastify/cors`, `@fastify/secure-session`, `@fastify/websocket`, `@fastify/multipart`, `@fastify/rate-limit`, `@fastify/compress`, `@fastify/swagger` + UI
- Prisma 5 + PostgreSQL (ORM + migrations)
- TypeScript 5 via `tsx` in dev / compiled `dist/` in prod
- Zod validates env at boot
- `@azure/msal-node` for Azure Entra ID OIDC (Authorization Code Flow + PKCE)
- Cloudinary for image uploads (penalty proof + memory wall)
- `pino` + `pino-pretty` logger

### Frontend (`frontend/`)

- React 18 + TypeScript 5
- Vite 5 (dev server + build)
- React Router 6
- Zustand 4 (+ persist middleware) — global store
- `html5-qrcode` — camera + QR decoding
- `qrcode.react` — generates the player's own QR
- `vite-plugin-pwa` — service worker + offline-ish behavior
- No CSS framework — vanilla CSS + design tokens (`src/styles/tokens.css`)

### Cross-cutting

- No linter in the repo — the only gate is `npm run typecheck` on both sides + walking the golden path in a browser
- Most UI copy is in **Thai** — when editing, preserve the Thai text

## Prerequisites

Before running, you need:

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS+ | Same version used by both backend and frontend |
| npm | 10+ | Comes with Node 20 |
| PostgreSQL | 14+ | Local or remote — set in `DATABASE_URL` |
| OpenSSL | (comes with git bash / linux / macOS) | to generate `SESSION_SECRET` |
| Cloudinary account | — | for image upload (penalty + memory wall) |
| 3 CSV files | — | Not included in the repo since they contain PII — obtain via the provided link |

CSVs needed for seeding:

- `Employee Data.csv`
- `Teamlead.csv`
- `TriviaQuestion AndTarget.csv`

Place all 3 files in `backend/scripts/`.

## Repo structure

```
5.5 Journey Pass Game/
├── backend/
│   ├── src/
│   │   ├── server.ts           # Fastify composition (CORS, session, swagger, routes)
│   │   ├── config.ts           # Zod env validation (exit 1 on bad env)
│   │   ├── routes/             # auth, missions, scans, penalty, chat, completion, memories
│   │   ├── domain/scan.ts      # processScan — core game rules (9 ScanOutcome variants)
│   │   ├── ws/                 # hub (in-process Map), pair channel, user channel
│   │   ├── db/prisma.ts        # Prisma client singleton
│   │   ├── lib/                # cloudinary, gameClock, triviaCardCache, etc.
│   │   └── middleware/auth.ts  # requireSession 401 helper
│   ├── prisma/
│   │   ├── schema.prisma       # Employee, TriviaCard, Scan, Pair, MemoryPhoto, PlayerProgress
│   │   └── migrations/         # 13 migrations
│   ├── scripts/
│   │   ├── seed.ts             # seeds the DB from the 3 CSV files (gitignored: scripts/*.csv)
│   │   ├── wipe.ts             # clears the DB
│   │   └── README.md           # how to get the CSVs
│   ├── .env.example            # env template (copy → .env, then edit)
│   ├── package.json
│   └── CLAUDE.md               # backend-specific architecture notes
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx, App.tsx, router.tsx
│   │   ├── api/                # client.ts (fetch + 401 redirect) + endpoints.ts
│   │   ├── features/           # welcome, auth, mission, trivia, teammate, scanner,
│   │   │                       # result, complete, qr, ranking, memoryWall, shell
│   │   ├── game/gameStore.ts   # Zustand store (persisted, key: journey-pass-5.5)
│   │   ├── lib/                # routes, useUserSocket, useWebSocket, errorStore...
│   │   ├── design-system/      # Button, Card, Avatar, Sheet, Stamp, Pill, ...
│   │   └── styles/             # tokens.css → accents.css → global.css
│   ├── public/, fonts/, assets/
│   ├── vite.config.ts
│   ├── package.json
│   └── CLAUDE.md               # frontend-specific architecture notes
│
├── shared/
│   └── types.ts                # cross-cutting domain types
│
├── CLAUDE.md                   # root architecture overview
├── DEPLOY.md                   # Railway + Vercel deploy guide (testing)
├── DEPLOY-INFRA.md             # company-infra deploy guide (production checklist)
└── README.md                   # ← this file
```

## Setup & Run (Local Development)

### 1. Clone + add the CSVs

```
git clone <repo>
cd "5.5 Journey Pass Game"
# Place Employee Data.csv, Teamlead.csv, TriviaQuestion AndTarget.csv
# into backend/scripts/ (see backend/scripts/README.md for the URL)
```

### 2. Backend

```
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` → your Postgres (e.g. `postgresql://postgres:postgres@localhost:5432/journey_pass`)
- `SESSION_SECRET` → generate with `openssl rand -hex 32` and paste it in (must be exactly 64 hex chars or Zod validation fails)
- `FRONTEND_ORIGIN` → `http://localhost:5173` (Vite's default)
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` → from the Cloudinary dashboard
- (optional) `GAME_END_AT` / `GAME_NOW_OVERRIDE` if testing the time-up flow
- (optional) `SEED_CREATE_TEST_USER=true` — creates a QA fixture `TEST-AWARDS` (username `testawards`) bound as the target of every trivia card, so scanning with any card always results in a `match` outcome. Off by default (do not enable in prod)

Login uses Azure Entra ID SSO — the `CLIENT_ID` / `CLIENT_SECRET` / authority values are hardcoded in `backend/src/lib/azureClient.ts`, not in env. To change the app registration, edit that file and rebuild. The Azure portal redirect URI must be `http://localhost:4000/api/auth/azure/callback` (dev) or `https://<api-host>/api/auth/azure/callback` (prod).

Apply migrations + seed:

```
# First run on an empty DB:
npx prisma migrate deploy   # apply every migration in prisma/migrations/
npm run seed                # reads the CSVs → upserts employees + trivia cards + distributes assignedLeaderId
```

Players have no password — they log in via Microsoft (Azure Entra ID) using their company email. The first time, the backend matches the employee by email and writes `azureOid` onto that row (auto-link). The seed log prints the employee count, leader count, a summary of the `assignedLeaderId` distribution, and a warning if a target id in the trivia CSV doesn't match the employee CSV.

Run the dev server:

```
npm run dev   # tsx watch + pino-pretty logs, listens on 0.0.0.0:4000
```

Check health: `curl http://localhost:4000/health` → `{"ok":true}`
Swagger UI: `http://localhost:4000/docs`

### 3. Frontend

Open a new terminal:

```
cd frontend
npm install
```

Create `.env.local` (Vite only reads env at build-time / dev-time):

```
VITE_API_BASE=http://localhost:4000/api
VITE_WS_BASE=ws://localhost:4000/api
```

In prod these must be `https://` and `wss://` — see `DEPLOY.md`.

Run:

```
npm run dev   # Vite at http://localhost:5173
```

Open a browser to `http://localhost:5173` (can also open on a phone via ngrok / LAN IP — the game is mobile-first).

### 4. Login + walk the golden path

All users come from an `Employee Data.csv` that you prepare yourself (contains PII, not included in the repo) — the employee's email is the key Azure SSO uses to link on first login (lowercase). No password is needed for login — just click "Sign in with Microsoft" and use the employee's company email account. You can find test id/email/leader status from:

- The `npm run seed` log (shows employee count + leader count + distribution)
- Querying Postgres directly:
```
SELECT id, username, name, year, "isLeader", "leaderClue" FROM "Employee" ORDER BY "isLeader" DESC, id;
```
- If `SEED_CREATE_TEST_USER=true` is set, there's a QA user `testawards` (id `TEST-AWARDS`) bound as the target on every trivia card, convenient for testing the match flow

Play sequence:

1. `/login` → username + password
2. `/missions` → choose Trivia or Teammate
   - Trivia: view your assigned cards → `/missions/trivia/cards` → pick a card → tap scan → open the camera to scan the QR of the person you think matches
   - Teammate: view your `leaderClue` (from the leader the system assigned you) + your cohort → scan a friend's/leader's QR → the system checks cohort + `assignedLeaderId` + leader-clash + slot full
3. If the scan succeeds (`chat` outcome) → `/chat/:pairId` → answer the question → confirm → the slot is added
4. If the Trivia scan is wrong → go to `/result/fail/:pairId` (the target uploads a proof photo)
5. Once all 10 quests are complete → `/complete` (calls `POST /completion`, idempotent)

## Commands cheat sheet

### Backend (run inside `backend/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | tsx watch + pretty logs |
| `npm run typecheck` | `tsc --noEmit` (no linter — this is the only gate) |
| `npm run build` | `prisma generate && tsc -p tsconfig.json` → `dist/` |
| `npm start` | prod: `prisma migrate deploy && node dist/server.js` |
| `npm run prisma:migrate -- --name <name>` | create a new migration |
| `npm run prisma:reset` | wipe the DB + apply migrations fresh (follow with `npm run seed`) |
| `npm run seed` | reads the CSVs → upserts seed data |
| `npm run wipe` | clears data without dropping the schema |

### Frontend (run inside `frontend/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server on :5173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc --noEmit && vite build` → `dist/` |
| `npm run preview` | preview the production build locally |
| `npm run lhci` | Lighthouse CI (config in `lighthouserc.json`) |

## Architecture highlights

Full architecture docs live in `CLAUDE.md` (root), `backend/CLAUDE.md`, and `frontend/CLAUDE.md`. This section is just a summary.

### Backend

- All HTTP routes are under `/api`, except `/health` and `/docs`
- Auth uses an `@fastify/secure-session` cookie `jp_sess` (8h) — automatically switches to `SameSite=None; Secure` when `FRONTEND_ORIGIN` is https
- 2 WebSocket channels:
  - `/api/ws/pair/:pairId` — the penalty page subscribes to sync state between both sides
  - `/api/ws/user` — push notifications to a user (`pair.created`, `trivia.found`, `penalty.update`, `game.ended`)
- The WS hub is an in-process `Map` — a restart loses state, and scaling beyond 1 replica means broadcasts don't reach every instance (a Redis/NATS backplane would need to be added first)
- The domain core lives in `src/domain/scan.ts::processScan` — 9 outcome variants: `match`, `mismatch`, `chat`, `wrong_year`, `wrong_leader`, `leader_clash`, `already_added`, `leader_full`, `teammate_full` (mirrored in 3 places: `shared/types.ts`, the local type in `scan.ts`, and `frontend/src/types/game.ts`)
- The teammate slot write is deferred to `POST /chat/:pairId/confirm-teammate` — `processScan` only creates the pair + an audit row; `addTeammateSlot` runs after the user answers the chat question (to prevent skipping the step)
- `Pair.id = sha256(sortedIds + ':' + kind + ':' + UTCdayBucket).slice(0,16)` — pairs rotate fresh every UTC midnight
- Trivia card → targets is many-to-many (`_TriviaCardTargets`) — a single card can have multiple correct answers
- Routes added: `GET /me/criteria` (the clue for every card the player is a target of, used to show on a profile "what others are looking for in you"), `GET /me/progress` also returns `leaderClue`, `GET /missions/teammate/start` returns `{ year, leaderClue }`

### Frontend

- Single Zustand store (`gameStore.ts`), persist key `journey-pass-5.5` v2
- `GameShell` = the main layout, wraps every route + manages `ProgressDock` and `MyQRSheet`
- `RequireAuth` redirects to `/login` if there's no profile
- Public projector routes (`/memory`, `/ranking`) bypass auth + chrome
- The Scanner uses `html5-qrcode`, with a 3s debounce + manual fallback ("type ID")
- The realtime path is `useUserSocket` (user channel), which only listens for `game.ended` + `pair.created` for a trivia target to trigger a redirect in `GameShell`; UI notifications (bell, auto-prompt) were removed because they were confusing — the whole flow is now driven by redirects instead. `usePairSocket` handles `penalty.update` on the penalty page
- Path alias `@/*` → `src/*` (both backend + frontend tsconfig)

## Key data model

- **Employee** — `id` is canonical, `username` lowercase, `isLeader` flag, `leaderClue: String?` (the clue shown to the player assigned to this leader)
- **TriviaCard** — many-to-many with Employee via the `TriviaCardTargets` relation (implicit join table `_TriviaCardTargets`)
- **Scan** — append-only audit log (the DB enum only has `MATCH`/`MISMATCH`; the other 9 variants exist only in TS) — some outcomes such as `already_added`, `leader_full`, `teammate_full`, `wrong_leader`, `leader_clash` are intentionally not written as a row
- **Pair** — drives realtime state (penalty + teammate confirm), 1 row per (sorted scanner+scanned, kind, UTC day) — fields: `targetConfirmed`, `proofPhotoUrl`, `penaltyKey` (no more `hunterConfirmed` — penalty is now a one-sided photo upload)
- **PlayerProgress** — JSON columns: `triviaStamps`, `teammateSlots` (cap 6 = 5 non-leader + 1 optional leader, enforced in code rather than schema via `pg_advisory_xact_lock`), `assignedCardIds` (the 5 locked-in cards), `assignedLeaderId` (the system-assigned leader; null for leader-players), `completedAt`, `updatedAt`

## Deployment

| Doc | Use case |
|-----|----------|
| `DEPLOY.md` | Railway (backend + Postgres) + Vercel (frontend) — for testing/staging |
| `DEPLOY-INFRA.md` | Company infrastructure checklist + questions to ask DevOps before deploying to production |

In short:

1. Provision Postgres + generate `SESSION_SECRET`
2. Set every env var in `backend/.env.example`
3. `npm run build && npm start` (runs `prisma migrate deploy` before listening)
4. First-time seed: `npm run seed` in an environment with the CSVs + prod `DATABASE_URL`
5. Deploy the frontend as static files (needs an `index.html` SPA fallback + proxying `/api/*` including WebSocket upgrades)

Hot tip: `npm start` runs `prisma migrate deploy`, but if your DB previously used `db push` (tables exist but `_prisma_migrations` is empty), the first run will fail with "relation already exists" — see the baselining steps in `DEPLOY.md` section 1.4.

## Troubleshooting

| Problem | Cause / fix |
|---------|-------------|
| Login 401 for every user | Forgot `npm run seed` after migrating — Postgres is empty |
| "Invalid environment" then exit 1 | Env is validated with Zod at boot — check `SESSION_SECRET` is exactly 64 hex chars |
| Cookie doesn't stick cross-site (prod) | `NODE_ENV=production` + both frontend/backend must be https + `FRONTEND_ORIGIN` must match exactly (no trailing slash) |
| WS connect fails | Use `wss://` (not `ws://`) in prod, path `/api/ws/pair/:id` or `/api/ws/user` |
| Build fails on Linux due to Prisma OpenSSL | Check `binaryTargets` in `prisma/schema.prisma` — default includes `["native", "debian-openssl-3.0.x"]` |
| Camera won't open | Requires https (except on localhost) — use ngrok for LAN testing |
| QR scan doesn't respond | The scanner has a 3s debounce on the same payload — try scanning a different QR first, or use the "type ID" button |
| Teammate scan succeeds but slot doesn't show | You must go to `/chat/:pairId`, answer the question, and confirm first — the slot write is deferred from `POST /scans` to `POST /chat/:pairId/confirm-teammate` |
| Scanning a leader always gives `wrong_leader` | You must scan only the leader the system assigned you (`assignedLeaderId`, distributed at seed time) — check via `GET /missions/teammate/start` or `GET /me/progress`, which returns `leaderClue` |

## Reference docs

Read alongside this file:

- `CLAUDE.md` — architecture overview for the whole monorepo
- `backend/CLAUDE.md` — backend gotchas not obvious from the source
- `frontend/CLAUDE.md` — router / store / scanner / notification stack
- `backend/scripts/README.md` — how to get the CSVs
- `DEPLOY.md` — Railway + Vercel
- `DEPLOY-INFRA.md` — production deploy checklist
- `backend/src/config.ts` — env schema (source of truth)
- `backend/prisma/schema.prisma` — DB schema
- `shared/types.ts` — cross-cutting domain types

## About this repository

This is a sanitized portfolio snapshot of an internal company event project. Company-specific references have been removed/genericized, and secrets have been redacted (see the source comments) — this copy is for showcasing the project's architecture and implementation, not for production use.
