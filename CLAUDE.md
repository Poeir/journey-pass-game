# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Monorepo with three top-level dirs:
- `frontend/` — Vite + React 18 + TypeScript + Zustand. Mobile-first, camera-driven game UI plus an admin portal at `/admin/*`. **See `frontend/CLAUDE.md` for the router, gameStore, i18n, scanner flow, admin shell, and design system.**
- `backend/` — Fastify 4 + Prisma 5 + PostgreSQL + WebSockets, ESM, TypeScript via `tsx` in dev / compiled `dist/` in prod. Cloudinary handles image storage for penalty proofs and memory wall photos. **See `backend/CLAUDE.md` for routes, domain logic, schema, caches, and gotchas.**
- `shared/types.ts` — single source of truth for cross-cutting domain types (`Employee`, `Profile`, `TriviaCard`, `ScanOutcome`, `WsEvent`). Both sides import from here; keep them in sync.

`DEPLOY.md` documents how to deploy this project — env vars, Postgres setup, seeding, ingress / WS requirements, and the open infra questions still pending DevOps.

## Authentication

Player login is **Azure Entra ID SSO** (OIDC Authorization Code Flow with PKCE). The OIDC client_id / client_secret are read from `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` env vars in `backend/src/lib/azureClient.ts` (the authority is hardcoded to `organizations`). The frontend has no password form — the welcome page just redirects to `GET /api/auth/azure/login`, the callback at `GET /api/auth/azure/callback` matches the Microsoft `email` claim against `Employee.email` and writes the session.

Two auxiliary auth surfaces:
- **Dev-only login bypass** — `routes/devAuth.ts` exposes `GET /auth/dev/employees` + `POST /auth/dev/login` so local dev / QA can log in as any seeded employee without Azure. Strictly opt-in: only registered when `DEV_LOGIN_ENABLED=true` in `backend/.env`, and `config.ts` refuses to boot if that flag is set with `NODE_ENV=production`. The frontend mirrors the gate via `VITE_DEV_LOGIN_ENABLED=true`.
- **Admin portal** — `routes/adminAuth.ts` provides `POST /admin/auth/login` against `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars (constant-time compare). Sets an `isAdmin` flag on the same `jp_sess` cookie. The `requireAdmin` middleware (`src/middleware/auth.ts`) gates every route in `routes/admin.ts`. **This is a placeholder** — when the real role model lands (Azure OID list / `Employee.isAdmin`), `requireAdmin` is the single replacement point. Admin sessions are independent from game sessions; a session can hold both.

## Backend quick reference

Run from `backend/`. `src/config.ts` validates env at boot via Zod and `process.exit(1)` on failure.

Required `.env`:
- `DATABASE_URL`, `SESSION_SECRET` (exactly 64 hex chars), `FRONTEND_ORIGIN` (full URL).
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` (≥ 8 chars).

Optional:
- `PORT` (default 4000), `NODE_ENV` (`development` | `production` | `test`).
- `GAME_END_AT` (ISO datetime override; default = today 17:00 Bangkok), `GAME_NOW_OVERRIDE` (fakes "now" for time-up testing).
- `DEV_LOGIN_ENABLED` (`"true"` only; refused in prod).
- `SEED_CREATE_TEST_USER` (seed-only; `"true"` upserts the `TEST-AWARDS` QA fixture and wires it as a target on every trivia card).

Scripts:
- `npm run dev` — `tsx watch --env-file=.env src/server.ts` with pino-pretty logs.
- `npm run typecheck` — `tsc --noEmit`. There is no test runner or linter.
- `npm run build` — `prisma generate && tsc && tsc-alias` (path-alias rewriter for the emitted JS).
- `npm start` — production: `prisma migrate deploy && node --env-file=.env dist/server.js`. Applies committed migrations under `prisma/migrations/`. Do **not** revert this to `db push --accept-data-loss`.
- `npm run prisma:migrate -- --name <name>` / `prisma:reset` / `seed` / `wipe`.
- Seed reads three CSVs from `backend/scripts/` (`Employee Data.csv`, `Teamlead.csv`, `TriviaQuestion AndTarget.csv`) — these carry employee PII and are NOT in the repo. See `backend/scripts/README.md`. After any reset, login 401s until `npm run seed` runs.

## Frontend quick reference

Run from `frontend/`. See `frontend/CLAUDE.md` for full details.
- `npm run dev` — Vite on `:5173`.
- `npm run typecheck` / `npm run build` (`tsc --noEmit && vite build`) / `npm run preview`.
- Backend wiring: `VITE_API_BASE=<url>/api`, `VITE_WS_BASE=wss://<url>/api`. `useUserSocket` derives the WS base from `VITE_API_BASE` if `VITE_WS_BASE` is unset.
- Dev login UI gate: `VITE_DEV_LOGIN_ENABLED=true` (must match the backend's `DEV_LOGIN_ENABLED`).

## Cross-cutting conventions

- **Shared types** — `shared/types.ts` is the source of truth for `Employee`, `Profile`, `TriviaCard`, `PenaltyState`, and the partial `WsEvent`. The nine-variant `ScanOutcome` is mirrored in three places — `shared/types.ts`, the local `ScanOutcome` type at the top of `backend/src/domain/scan.ts`, and `frontend/src/types/game.ts`. When adding/renaming a variant, change all three plus the scanner branching in `frontend/src/features/scanner/ScannerPage.tsx`.
- **Cohort cutoff** — `SENIOR_COHORT_CUTOFF = 2023` is duplicated in `backend/src/domain/scan.ts` (`inSameYearGroup`) and `frontend/src/game/gameStore.ts` (`formatYearGroup`). Pre-2023 hires are one cohort; 2023+ split by year. Keep the two constants in sync.
- **i18n** — UI copy is fully bilingual via `frontend/src/lib/i18n/` (`th` default, `en` fallback). Strings live in `locales/en.ts` and `locales/th.ts`; resolve via `useT()` (component) or `t(key, vars)` / `tList(key)` (imperative). Default language is Thai (`languageStore` persist key `jp_lang`); the `LanguageToggle` design-system component switches languages. Backend log strings and seed CSV content stay as-is (Thai where original).
- **Frontend ownership** — the user often hand-edits frontend files. On cross-stack tasks, check before touching `frontend/src/**`.
- **Path aliases** — both packages use `@/*` → their respective `src/*` (Vite + tsconfig on the frontend, tsconfig + `tsc-alias` + tsx on the backend). Backend imports specify the `.js` extension on relative paths (e.g. `'@/db/prisma.js'`) because the project is ESM with NodeNext-style resolution; do not strip the `.js` even though the source is `.ts`.
