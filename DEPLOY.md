# Deployment Guide — Journey Pass (5.5)

เอกสารนี้สำหรับ dev ที่จะนำโปรเจคนี้ไป deploy บน infra ของบริษัท สรุปจาก source ใน repo ทั้งหมด (ไฟล์อ้างอิงระบุไว้ทุกข้อ)

---

## 1. โปรเจคนี้คืออะไร

**Journey Pass (5.5)** เป็นเกม onboarding-day แบบ mobile-first สำหรับพนักงาน ~200 คน ผู้เล่น login ผ่านมือถือแล้วเดินไปสแกน QR ของกันและกันเพื่อเก็บ trivia stamp + ฟอร์มทีม 5+1 คน

Monorepo มี 3 ส่วน:

| ส่วน | Path | Stack | Deploy artifact |
|---|---|---|---|
| Backend | `backend/` | Node.js 20 (ESM) + Fastify 4 + Prisma 5 + PostgreSQL | `backend/dist/` (compiled JS) + `prisma/` |
| Frontend | `frontend/` | Vite + React 18 + Zustand + PWA | `frontend/dist/` (static SPA + service worker) |
| Shared types | `shared/types.ts` | (build-time only) | — |

External services ที่ backend ใช้งาน:
- **PostgreSQL** — datasource หลักของ Prisma
- **Cloudinary** — เก็บรูป penalty proof + memory wall (`backend/src/lib/cloudinary.ts`)
- **Azure Entra ID (Microsoft identity platform)** — SSO login ผ่าน OIDC Authorization Code Flow + PKCE (`backend/src/lib/azureClient.ts`)
- **Outbound HTTPS** ไป `api.cloudinary.com` และ `login.microsoftonline.com`

Backend เปิด HTTP **และ** WebSocket บน port เดียวกัน (Fastify + `@fastify/websocket`); frontend เป็น static SPA + service worker (PWA) — host ที่ไหนก็ได้ที่เสิร์ฟ static + ทำ SPA fallback ได้

Game scope: ~200 concurrent users, จัด event 1 วัน, deadline default = วันนี้ 17:00 Asia/Bangkok

---

## 2. Backend

### 2.1 Build & start

ทุกคำสั่งรันจาก `backend/` (อ้างอิง `backend/package.json:6-17`):

```bash
npm ci                  # install (lockfile committed)
npm run build           # prisma generate + tsc → dist/
npm start               # prisma migrate deploy && node dist/server.js
```

หมายเหตุ:
- `postinstall` รัน `prisma generate` อัตโนมัติ — ถ้า build container แบบไม่มี internet ตอน install ต้อง pre-fetch Prisma engine
- `npm start` รัน `prisma migrate deploy` ก่อน listen เสมอ — migration ที่ commit จะ apply ทุก deploy
- ไม่มี test runner / linter — gate เดียวคือ `npm run typecheck` ผ่าน

### 2.2 Node.js version

`backend/package.json` ระบุ `@types/node ^20` → ใช้ **Node.js 20 LTS ขึ้นไป**

### 2.3 Required environment variables

ทั้งหมด validate ด้วย Zod ที่ boot — **ตัวใดผิด/ขาด server `process.exit(1)` ทันที** (อ้างอิง `backend/src/config.ts`)

| Key | Type | Required | หมายเหตุ |
|---|---|---|---|
| `NODE_ENV` | `development\|production\|test` | default `development` | ตั้ง `production` ใน prod (toggle pino log + ปิด request log) |
| `DATABASE_URL` | URL | ✅ | Postgres connection string ดู connection pool ใน 2.7 |
| `SESSION_SECRET` | string **exactly 64 hex chars** | ✅ | gen ด้วย `openssl rand -hex 32`; ผิด length → Zod fail |
| `FRONTEND_ORIGIN` | URL | ✅ | URL frontend แบบเต็ม (ไม่มี trailing slash) ใช้ทั้ง CORS allowlist + toggle cookie cross-site mode |
| `PORT` | int | default `4000` | bind `0.0.0.0:${PORT}` |
| `CLOUDINARY_CLOUD_NAME` | string | ✅ | |
| `CLOUDINARY_API_KEY` | string | ✅ | |
| `CLOUDINARY_API_SECRET` | string | ✅ | |
| `GAME_END_AT` | ISO 8601 +offset | optional | default = วันนี้ 17:00 Asia/Bangkok |
| `GAME_NOW_OVERRIDE` | ISO 8601 +offset | optional | **เฉพาะ test** — ห้ามตั้งใน prod |

Env เพิ่มเติมที่ใช้เฉพาะตอน seed (ไม่ใช่ runtime):

| Key | Required ตอน seed | หมายเหตุ |
|---|---|---|
| `SEED_CREATE_TEST_USER` | optional | `=true` จะ upsert QA fixture `TEST-AWARDS` (username `testawards`) ที่ scan แล้ว match ทุกการ์ด **ตั้งเป็น false / unset ใน prod** |

**Azure Entra ID SSO credentials**: client_id, client_secret, และ authority ถูก **hard-code** ใน `backend/src/lib/azureClient.ts` ตามคำขอของเจ้าของโปรเจค ไม่ได้อยู่ใน env ฉะนั้น:

- เปลี่ยน secret = แก้ไฟล์ + redeploy (ไม่มี env var ให้สลับ)
- secret ติดอยู่ใน git history ทั้งหมด ถ้ารั่วต้อง rotate ที่ Azure Portal + แก้ไฟล์ + force-purge history (BFG / git filter-repo) ตามขั้นตอนเดียวกับ PII CSV ใน 2.11
- **ค่าที่ใช้อยู่จริงเป็น single-tenant app registration ของบริษัท** ใน Azure Portal — ไม่ควร commit credential ของ tenant อื่นมาทับ

ตัว callback ใช้ redirect URI ที่ derive จาก request (`x-forwarded-proto` + `x-forwarded-host`) อัตโนมัติ — ฉะนั้นต้องเพิ่ม redirect URI ที่ตรงกับ origin ที่ deploy ใน Azure App registration:

```
https://<api-host>/api/auth/azure/callback
```

(สำหรับ local dev: `http://localhost:4000/api/auth/azure/callback`)

### 2.4 Network paths

Server bind `0.0.0.0:${PORT}` (`backend/src/server.ts:173`) Layout:

| Path | Type | หมายเหตุ |
|---|---|---|
| `/health` | HTTP GET | liveness probe — root, **ไม่อยู่ใต้ `/api`** ตอบ `{"ok":true}` ไม่แตะ DB ใช้เป็น readiness ได้เช่นกัน |
| `/docs` | HTTP GET | Swagger UI |
| `/api/*` | HTTP | route ทั้งหมด |
| `/api/ws/pair/:pairId` | WebSocket | per-pair channel (penalty page) |
| `/api/ws/user` | WebSocket | per-user notification channel |

Reverse proxy / Ingress ที่ใช้ ต้องรองรับ **WebSocket upgrade** บน `/api/ws/*` (NGINX → set `Upgrade`/`Connection` headers, ALB → enable WS, Traefik → automatic)

### 2.5 Cookie & CORS

อ้างอิง `backend/src/server.ts:47-64`

- Cookie name `jp_sess`, `httpOnly: true`, `maxAge: 8h`, `path: /`
- Toggle อัตโนมัติด้วย scheme ของ `FRONTEND_ORIGIN`:
  - `https://...` → `SameSite=None; Secure` (cross-site prod)
  - มิฉะนั้น → `SameSite=Lax` (local dev)
- CORS lock ที่ `FRONTEND_ORIGIN` exact, `credentials: true`

ผลที่ตามมา:
- **Cross-origin prod ต้อง https ทั้งคู่** ไม่งั้น browser reject cookie
- ถ้า TLS terminate ที่ ingress แล้วส่ง http เข้า app — ค่า `FRONTEND_ORIGIN` ใน backend env ยังต้องเป็น `https://...` เพื่อให้ flag cookie ถูกต้อง
- Same-origin (proxy ผ่าน path เดียวกัน) → http dev ก็ยังใช้ได้

### 2.6 Resource & timeout (in-code)

จาก `backend/src/server.ts`:

- `connectionTimeout: 30s`, `keepAliveTimeout: 30s`, `requestTimeout: 60s` (Cloudinary upload อาจช้าได้ ~10s บนมือถือเครือข่ายช้า)
- Multipart upload: **8MB / 1 file** ต่อ request
- Rate limit global: **300 req/min** (ไม่มี per-route override; login เป็น OIDC redirect ไป Microsoft ฝั่งเดียว ไม่กิน CPU บน backend)
- Compression: gzip + deflate (threshold 1024 bytes) — Brotli ปิดเพื่อจำกัด CPU
- Cloudinary upload semaphore: **8 concurrent** (`backend/src/lib/cloudinary.ts`)

### 2.7 Postgres connection pool

Prisma default = `cpu * 2 + 1` — ต่ำเกินไปสำหรับ 1 vCPU container ที่เสิร์ฟ ~200 users

แนะนำ override ใน `DATABASE_URL`:
```
?connection_limit=20&pool_timeout=20
```

ต้องเช็ค: `connection_limit × replicas < Postgres max_connections`

### 2.8 ⚠️ WebSocket hub เป็น in-process — single replica only

WS hub (`backend/src/ws/hub.ts`) เก็บ subscriber set แบบ `Map<string, Set<WebSocket>>` ใน memory ของ process:

- ❌ ไม่ persistent — restart = subscriber set หาย ผู้เล่นต้อง refresh เพื่อ reconnect
- ❌ ไม่ทำงาน cross-replica — broadcast จาก replica A ส่งไม่ถึง subscriber บน replica B

**ผลลัพธ์**: deploy ได้ **1 replica เท่านั้น** จนกว่าจะใส่ pub/sub backplane (Redis pub/sub / NATS) เข้าไปใน `ws/hub.ts` ก่อน

สำหรับ scope ปัจจุบัน (~200 users, event วันเดียว) — 1 replica เพียงพอ; rolling deploy ระหว่าง event live = drop WS connection ทั้งหมด ผู้เล่นต้อง refresh

### 2.9 Database

- **PostgreSQL** — Prisma 5.22 รองรับ 9.6+ แนะนำ **14+**
- Schema: `backend/prisma/schema.prisma`
- Migrations: 13 files ที่ commit ใน `backend/prisma/migrations/` `migrate deploy` apply ทั้งหมดเรียงตาม timestamp prefix
- Prisma `binaryTargets = ["native", "debian-openssl-3.0.x"]` (`schema.prisma:3`) — ถ้า base image **ไม่ใช่ Debian + OpenSSL 3.0** (เช่น Alpine, Amazon Linux 2) ต้องเพิ่ม binary target ที่ตรงกับ OS เช่น `linux-musl-openssl-3.0.x` แล้ว rebuild

### 2.10 First-time DB setup + seeding

1. Provision empty Postgres database
2. `npm start` (หรือรัน `npx prisma migrate deploy` แยก) จะ apply migration ทั้งหมด
3. **ต้อง seed** ไม่งั้น login ทุก user 401 (ตาราง employee ว่าง):
   ```bash
   cd backend
   npm run seed     # ใช้ DATABASE_URL + SEED_DEFAULT_PASSWORD ของ prod
   ```

**`npm run seed` ทำอะไร** (`backend/scripts/seed.ts`):
- อ่าน CSV 3 ไฟล์ จาก `backend/scripts/`:
  - `Employee Data.csv` → upsert `Employee` table; `username` = `Company Email` (lowercase) หรือ fallback เป็น `id` lowercase; `email` ถูกเก็บเป็น lowercase ด้วย — Azure SSO callback จะใช้ฟิลด์นี้ match ครั้งแรกแล้วเขียน `azureOid` ลงเอง (ไม่มี password column ที่ต้อง hash)
  - `Teamlead.csv` → flag `isLeader=true` + เก็บ `leaderClue` ของ ID ที่อยู่ในไฟล์นี้
  - `TriviaQuestion AndTarget.csv` → upsert `TriviaCard` rows (id = `CARD-01..CARD-NN`) + connect target employees แบบ many-to-many
- ทำ even-distribution pass: assign `assignedLeaderId` ให้ทุก non-leader player (greedy by-count, alphabetical tiebreak)
- ถ้า `SEED_CREATE_TEST_USER=true` → upsert `TEST-AWARDS` (username `testawards`) และ connect เป็น target ของทุกการ์ด

Idempotent (`upsert`) — รันซ้ำได้ แต่จะไม่ลบ row ที่ถูกถอดออกจาก CSV (ถ้าต้องการ clean ใช้ `npm run wipe` หรือ `prisma migrate reset` ก่อน)

### 2.11 ⚠️ CSV seed files — ไม่ได้อยู่ใน repo (PII)

CSV ทั้ง 3 ไฟล์ที่ `seed.ts` ต้องการ มี **PII ของพนักงานจริง** จึงถูก ignore ใน `backend/.gitignore` (`scripts/*.csv`) **ไม่ถูก commit** ใน repo

**วิธีรับไฟล์**: ดาวน์โหลดผ่าน private link ที่ทีม Internship/PM แจกให้ แล้ววางที่ `backend/scripts/` ก่อนรัน seed รายละเอียดดู `backend/scripts/README.md`

> ห้าม `git add -f scripts/*.csv` เด็ดขาด ถ้าเผลอ commit ขึ้น remote ต้อง rewrite history (`git filter-repo`/BFG) + force-push + แจ้งทีมให้ตรวจสอบ PII ที่หลุด

### 2.12 Baseline migration (ถ้าเคยใช้ `db push` มาก่อน)

ถ้า DB target เคย sync ด้วย `prisma db push` (table ครบแต่ตาราง `_prisma_migrations` ว่าง) — `migrate deploy` ครั้งแรกจะ fail `relation "X" already exists` ต้อง mark applied ทุก migration ด้วยตัวเองก่อน:

```bash
cd backend
for m in prisma/migrations/*/; do
  name=$(basename "$m")
  npx prisma migrate resolve --applied "$name"
done
```

ถ้าเป็น DB ใหม่ (clean) **ไม่ต้องทำขั้นนี้**

### 2.13 ไม่มี Dockerfile ใน repo

repo ไม่มี `Dockerfile`, `Containerfile`, `Procfile`, หรือ buildpack config — ขึ้นกับ infra ที่บริษัทเลือก dev ที่ deploy ต้องเขียนเอง

แนะนำ pattern:
- Multi-stage: `builder` รัน `npm ci && npm run build` → `runner` copy `dist/`, `prisma/`, `package.json`, `package-lock.json`, `node_modules/` (production-only)
- Base image `node:20-bookworm-slim` ตรงกับ `binaryTargets = "debian-openssl-3.0.x"` ที่ตั้งไว้แล้ว — ไม่ต้องแก้อะไรเพิ่ม
- ถ้าอยาก slim กว่านั้นต้องเปลี่ยน base + เพิ่ม binary target

---

## 3. Frontend

### 3.1 Build

จาก `frontend/` (`frontend/package.json`):

```bash
npm ci
npm run build       # tsc --noEmit && vite build → dist/
```

Output `frontend/dist/` คือ static files พร้อมเสิร์ฟ — มี service worker (`vite-plugin-pwa`) บังคับ HTTPS ใน prod

### 3.2 Required env (build-time)

Vite อ่าน env ตอน **build** — เปลี่ยนค่า = ต้อง rebuild + redeploy

| Key | Value | หมายเหตุ |
|---|---|---|
| `VITE_API_BASE` | `https://<backend-host>/api` | ต้องลงท้ายด้วย `/api` |
| `VITE_WS_BASE` | `wss://<backend-host>/api` | ต้องลงท้ายด้วย `/api` |

Same-origin topology → ใช้ relative path: `VITE_API_BASE=/api`, `VITE_WS_BASE=wss://<host>/api`

### 3.3 Hosting requirements

- **SPA fallback** — ทุก unmatched route ต้องตอบ `index.html` (เช่น NGINX `try_files $uri /index.html;`)
- **HTTPS บังคับ** — service worker จะไม่ register ถ้าเป็น http (ยกเว้น localhost)
- ถ้าใช้ same-origin proxy:
  - `/api/*` → backend
  - `/api/ws/*` → backend แบบ **WebSocket upgrade**
- Cache headers ที่แนะนำ:
  - `index.html` → `Cache-Control: no-cache` (ต้องอ่านใหม่เพื่อรับ asset hash ใหม่)
  - `/assets/*` (hashed) → `Cache-Control: public, max-age=31536000, immutable`

---

## 4. Topology — เลือก same-origin หรือ cross-origin

**A) Same-origin (แนะนำ — ง่ายที่สุดกับ cookie)**
- Ingress / reverse proxy ตัวเดียวเสิร์ฟทั้งคู่:
  - `/` → frontend static
  - `/api/*` → backend (รวม `/api/ws/*` ด้วย WS upgrade)
- `FRONTEND_ORIGIN` = origin ของ ingress
- Frontend ใช้ relative path `VITE_API_BASE=/api`
- ใช้ http dev ได้, prod ต้อง https

**B) Cross-origin**
- Frontend คนละ host จาก backend
- ทั้งคู่ **ต้อง https**
- `FRONTEND_ORIGIN` ใน backend env = exact URL frontend (ไม่มี trailing slash)
- Ingress backend ต้องไม่กิน CORS preflight เอง — Fastify ตอบ CORS

---

## 5. Cross-cutting

### 5.1 TLS

Cookie cross-site mode + service worker บังคับ HTTPS ใน prod TLS terminate จุดไหนก็ได้ (ingress / LB / app) — ที่สำคัญคือ `FRONTEND_ORIGIN` ใน backend env ต้องสะท้อน scheme ที่ browser เห็น

### 5.2 Logging

- Backend ใช้ pino — ใน `NODE_ENV=production` log JSON บน stdout, level `warn` (`backend/src/server.ts:25-26`)
- ปิด request logging ใน prod (`disableRequestLogging`) เพื่อลด volume
- ไม่มี APM / metrics endpoint / tracing setup ใน repo

ถ้าบริษัทมี centralize log (ELK / Loki / Datadog / CloudWatch) — เก็บ stdout ก็พอ ไม่ต้องเพิ่ม code

### 5.3 Time zone

โค้ดทำ TZ-aware เอง:
- `Pair.id` ผูก `dayBucket` แบบ UTC date (`new Date().toISOString().slice(0,10)`) — pair roll over ที่ UTC midnight
- Default `GAME_END_AT` = 17:00 Asia/Bangkok (hard-coded `+07:00` ใน `gameClock.gameEndAt()`)

→ Container TZ ไม่ซีเรียส ตั้ง UTC ใช้ได้ปกติ

### 5.4 CI/CD

repo ไม่มี `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines.yml` — ตรวจแล้ว ต้องเขียนเองตาม pipeline ของบริษัท ขั้นตอน build อ้างอิง section 2.1 + 3.1

---

## 6. ขั้นตอน deploy ครั้งแรก

exact command ขึ้นกับ platform — ลำดับเชิงตรรกะคือ:

1. **Provision Postgres** — สร้าง database + role + grant ให้ app
2. **เตรียม secrets**:
   - `openssl rand -hex 32` → `SESSION_SECRET`
   - Cloudinary credentials
   - Azure App registration (single-tenant, company tenant) — เพิ่ม redirect URI `https://<api-host>/api/auth/azure/callback` แล้วตั้งค่า `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` เป็น env var ก่อน build
3. **Build artifacts**:
   - Backend: `cd backend && npm ci && npm run build` — ส่ง `dist/`, `node_modules/` (prod), `prisma/` (รวม `migrations/`), `package.json`, `package-lock.json`, `scripts/seed.ts` ไป runtime
   - Frontend: `cd frontend && npm ci && VITE_API_BASE=... VITE_WS_BASE=... npm run build` — upload `frontend/dist/` ไป static host
4. **Set runtime env vars** ทั้งหมดใน 2.3 (production set)
5. **Start backend** — `npm start` รัน `prisma migrate deploy` แล้ว listen
6. **Seed DB** (ครั้งเดียว — ต้องตั้ง `DATABASE_URL` ใน environment ที่รัน):
   - วาง CSV 3 ไฟล์ที่ดาวน์โหลดจาก private link ใน `backend/scripts/`
   - `cd backend && npm run seed`
   - **ลบ CSV ออกจาก runtime image/volume หลัง seed เสร็จ** (PII)
7. **Verify**:
   - `curl https://<backend>/health` → `{"ok":true}`
   - เปิด `https://<frontend>/login` → กดปุ่ม "Sign in with Microsoft" → redirect ไป `login.microsoftonline.com` → login ด้วย account อีเมลบริษัทของพนักงาน → กลับมาที่ `/user` พร้อม cookie
   - DevTools → Network → response ของ `/auth/azure/callback` มี `Set-Cookie: jp_sess=...; SameSite=None; Secure; HttpOnly`
   - DevTools → WS → เห็น `wss://<backend>/api/ws/user` connect 101 สำเร็จ
   - เดิน golden path: scan trivia card → success / mismatch flow
   - เปิด 2 browser → A scan B → trivia.found ขึ้น bell ของ B ทันที (พิสูจน์ WS broadcast)
   - DB check (Prisma Studio): row Employee ของผู้ที่เพิ่ง login ต้องมี `azureOid` เซ็ตแล้ว (auto-link ครั้งแรกจาก email)

---

## 7. Troubleshooting

| อาการ | สาเหตุที่เป็นไปได้ |
|---|---|
| Cookie ไม่ติด cross-site | `NODE_ENV` ไม่ใช่ `production` / มีฝั่งใดฝั่งหนึ่งเป็น http / `FRONTEND_ORIGIN` ไม่ตรง exact (เช็ค trailing slash, port, scheme) |
| CORS error ใน browser | Origin ของ frontend ที่เข้าจริงไม่ตรงกับ `FRONTEND_ORIGIN` ใน backend env (ตัวพิมพ์ + scheme เป๊ะ) |
| WS connect 4xx/timeout | ใช้ `wss://` (ไม่ใช่ `ws://`) ใน prod / path ผิด (ถูกต้อง: `/api/ws/pair/:id` หรือ `/api/ws/user`) / ingress ไม่ได้ enable WebSocket upgrade |
| Prisma `Error querying engine` ตอน start | binary target ไม่ตรง OS — เพิ่ม target ใน `schema.prisma:3` แล้ว rebuild |
| Login จบที่ `/login?error=not_registered` | Azure auth สำเร็จแต่ email ไม่มีใน DB — ลืม seed หรือ email ของ user ไม่อยู่ใน CSV |
| Login จบที่ `/login?error=auth_failed` | callback ล้มเหลว — เช็ค (1) redirect URI ใน Azure App registration ตรงกับที่ backend ส่ง (`x-forwarded-*` headers ผ่าน proxy ให้ครบ), (2) `CLIENT_SECRET` ใน `azureClient.ts` ตรงกับที่ Azure Portal, (3) tenant ของ user ได้รับอนุญาต (single-tenant app block guest) |
| Microsoft block "AADSTS50020 / AADSTS50194" | user มาจาก tenant อื่นที่ single-tenant app ไม่อนุญาต — ตั้งใจให้ block อยู่แล้ว (security feature) |
| Seed `ENOENT ... Employee Data.csv` | ลืมวาง CSV ใน `backend/scripts/` ก่อนรัน seed |
| `migrate deploy` fail `relation already exists` | DB เคยใช้ `db push` มาก่อน — ทำขั้น baseline ใน 2.12 |
| `npm start` fail ตอน `migrate deploy` connect DB | DB start ทีหลัง backend — ใส่ readiness check / wait-for-it script ใน orchestrator |
| รูป upload ไม่ขึ้น Cloudinary | เช็ค Cloudinary credentials ทั้ง 3 ตัว / outbound HTTPS ไป `api.cloudinary.com` ถูก firewall บล็อกไหม |
| ผู้เล่นถูก kick ระหว่าง deploy | คาดได้ — 1 replica = WS หลุดทั้งหมดตอน restart ผู้เล่น refresh แล้วเข้าต่อได้ |

---

## 8. ไฟล์อ้างอิงใน repo

| ไฟล์ | ใช้ดูอะไร |
|---|---|
| `CLAUDE.md` (root) | Architecture overview ของทั้ง monorepo |
| `backend/CLAUDE.md` | Backend file-level gotchas (server composition, routes, scan domain, WS hub) |
| `frontend/CLAUDE.md` | Frontend architecture (router, gameStore, scanner, notification stack) |
| `backend/src/config.ts` | Env validation = source of truth |
| `backend/src/server.ts` | Server composition, CORS, cookie, timeouts |
| `backend/prisma/schema.prisma` | DB schema + Prisma binary targets |
| `backend/prisma/migrations/` | 13 migration files (apply เรียงตาม timestamp prefix) |
| `backend/.env.example` | Env template (มี comment อธิบายทุกตัว) |
| `backend/.gitignore` | ยืนยันว่า `scripts/*.csv` ถูก block |
| `backend/scripts/README.md` | วิธีรับและวาง CSV PII ก่อน seed |
| `backend/scripts/seed.ts` | Seed pipeline (CSV → Postgres + assignedLeaderId distribution) |
| `backend/src/lib/cloudinary.ts` | Cloudinary integration + upload semaphore |
| `backend/src/ws/hub.ts` | In-process WS hub (จุดที่ต้องแก้ถ้าจะ scale > 1 replica) |
| `frontend/vite.config.ts` | PWA + asset chunking + image optimizer |
