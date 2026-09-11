# 5.5 Journey Pass

เกมในงาน **Company Day** ที่เล่นผ่านมือถือ ใช้กล้องสแกน QR Code ของพนักงานเพื่อทำภารกิจให้ครบ ก่อนเวลาจบเกม

ผู้เล่นจะ login เข้ามือถือตัวเอง รับ QR ของตัวเอง (ใช้ให้คนอื่นสแกน) และเปิดกล้องสแกน QR ของคนอื่นเพื่อเก็บแสตมป์ทั้ง 2 ภารกิจ — รวมแล้ว **5 trivia stamps + 5 teammate slots = 10 quests** ถึงจะ complete

---

## ภาพรวม (What & Why)

โปรเจคนี้เป็น **monorepo** ที่ประกอบด้วย:

| ส่วน | คำอธิบาย |
|---|---|
| `frontend/` | Mobile-first PWA ที่ผู้เล่นใช้เล่นเกม (เปิดกล้อง / สแกน / ดูแสตมป์) |
| `backend/` | API + WebSocket hub + ตัวประมวลผลกติกาเกมทั้งหมด |
| `shared/types.ts` | Domain types ที่ทั้ง 2 ฝั่ง import ใช้ร่วมกัน (`Employee`, `ScanOutcome`, `WsEvent`) |

### ภารกิจในเกม (2 missions)

1. **Trivia** — ผู้เล่นได้รับ trivia card 5 ใบสุ่มจากระบบ (เก็บ id ไว้บน `assignedCardIds` ครั้งแรกที่เปิดภารกิจ ครั้งต่อๆ ไปได้ใบเดิม) แต่ละใบมี clue ที่บรรยายลักษณะของพนักงาน 1 คน (หรือมากกว่า — relation `targets` เป็น many-to-many) ผู้เล่นต้องเดาว่าใครตรง clue แล้วไป **สแกน QR ของคนนั้น**
   - เดาถูก → `match` → ได้แสตมป์, คนถูกเดาได้รับแจ้งเตือนผ่าน WebSocket
   - เดาผิด → `mismatch` → สร้าง penalty pair ทั้งสองฝั่ง ต้องไปหน้า penalty (target อัปโหลดรูปยืนยัน) ก่อนถึงจะ scan ต่อได้
2. **Teammate** — หา **5 เพื่อนใน cohort เดียวกัน** + **1 leader ที่ระบบกำหนดให้** (extra/bonus) มาเข้าทีม
   - **Cohort**: คน hire ก่อนปี 2022 รวมเป็น cohort เดียว; ตั้งแต่ปี 2022 เป็นต้นไปแยก cohort ตามปี (ดู `inSameYearGroup` ใน `domain/scan.ts`)
   - scan คนต่าง cohort และทั้งคู่ไม่ใช่ leader → `wrong_year`
   - แต่ละผู้เล่นถูก seed ผูกกับ leader 1 คน (`assignedLeaderId` กระจายแบบ greedy least-assigned) — scan leader คนอื่นที่ไม่ใช่คนของตัวเอง → `wrong_leader`; ตัวเองเป็น leader แล้ว scan leader อีกคน → `leader_clash`
   - scan ผ่านแล้วได้ outcome `chat` → ระบบสร้าง teammate `Pair` แต่ **ยังไม่เพิ่ม slot จริง** ต้องไปหน้า `/chat/:pairId` ตอบคำถามแล้ว `POST /chat/:pairId/confirm-teammate` ถึงจะลง slot
   - leader นับเป็น **extra** ไม่นับใน 10 quests ที่ต้องทำให้ครบ (5 trivia stamps + 5 non-leader teammate slots = 10)

### หน้าจอ projector สาธารณะ (ไม่ต้อง login)

- `/memory` — Memory Wall โชว์รูปภาพที่ผู้เล่นถ่ายตอน success
- `/ranking` — แสดงคนที่ทำเสร็จแล้ว / ยังเล่นอยู่ + เหลืออีกกี่ quest, poll ทุก 10s

### Game clock & time-up

มีกำหนดเวลาจบเกม (`GAME_END_AT`, default = วันนี้ 17:00 Asia/Bangkok) เมื่อหมดเวลา server จะ broadcast `game.ended` ให้ทุก client redirect ไป `/time-up` ผู้เล่นที่ยังไม่ครบ 10 quests จะไม่ถูก mark `completedAt`

---

## Tech Stack

### Backend (`backend/`)
- **Node.js 20 LTS+** (ESM, `type: module`)
- **Fastify 4** + plugins: `@fastify/cors`, `@fastify/secure-session`, `@fastify/websocket`, `@fastify/multipart`, `@fastify/rate-limit`, `@fastify/compress`, `@fastify/swagger` + UI
- **Prisma 5** + **PostgreSQL** (ORM + migrations)
- **TypeScript 5** ผ่าน `tsx` ตอน dev / compiled `dist/` ตอน prod
- **Zod** validate env ตอน boot
- **@azure/msal-node** สำหรับ Azure Entra ID OIDC (Authorization Code Flow + PKCE)
- **Cloudinary** สำหรับ upload รูป (penalty proof + memory wall)
- **pino** + `pino-pretty` logger

### Frontend (`frontend/`)
- **React 18** + **TypeScript 5**
- **Vite 5** (dev server + build)
- **React Router 6**
- **Zustand 4** (+ persist middleware) — global store
- **html5-qrcode** — กล้อง + QR decoding
- **qrcode.react** — generate QR ของผู้เล่น
- **vite-plugin-pwa** — service worker + offline-ish behavior
- ไม่มี CSS framework — ใช้ vanilla CSS + design tokens (`src/styles/tokens.css`)

### ข้ามฝั่ง
- ไม่มี linter ใน repo — gate เดียวคือ `npm run typecheck` ทั้ง 2 ฝั่ง + เดิน golden path บน browser
- UI copy ส่วนใหญ่เป็น **ภาษาไทย** — แก้ไขโดยรักษา Thai text ไว้

---

## Prerequisites

ก่อนรันต้องมี:

| Tool | Version | หมายเหตุ |
|---|---|---|
| Node.js | 20 LTS+ | ทั้ง backend และ frontend ใช้ตัวเดียวกัน |
| npm | 10+ | ใช้ตามมากับ Node 20 |
| PostgreSQL | 14+ | local หรือ remote ก็ได้ — ใส่ใน `DATABASE_URL` |
| OpenSSL | (มากับ git bash / linux / macOS) | gen `SESSION_SECRET` |
| Cloudinary account | — | สำหรับ image upload (penalty + memory wall) |
| ไฟล์ CSV 3 ไฟล์ | — | **ไม่อยู่ใน repo** เพราะมี PII — โหลดลิ้งค์ตามที่แนบให้

CSV ที่ต้องการสำหรับ seed:
- `Employee Data.csv`
- `Teamlead.csv`
- `TriviaQuestion AndTarget.csv`

วางไฟล์ทั้ง 3 ไว้ที่ `backend/scripts/`

---

## โครงสร้าง repo

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
│   │   ├── seed.ts             # ใช้ CSV 3 ไฟล์ seed DB (gitignored: scripts/*.csv)
│   │   ├── wipe.ts             # ล้าง DB
│   │   └── README.md           # วิธีรับ CSV
│   ├── .env.example            # template env (copy → .env แล้วแก้)
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

---

## Setup & Run (Local Development)

### 1. Clone + ใส่ CSV

```bash
git clone <repo>
cd "5.5 Journey Pass Game"
# วางไฟล์ Employee Data.csv, Teamlead.csv, TriviaQuestion AndTarget.csv
# ลงใน backend/scripts/ (ดู backend/scripts/README.md เพื่อรับ URL)
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

แก้ `.env`:
- `DATABASE_URL` → Postgres ของคุณ (e.g. `postgresql://postgres:postgres@localhost:5432/journey_pass`)
- `SESSION_SECRET` → gen ด้วย `openssl rand -hex 32` แล้ววาง (ต้อง **64 hex chars เป๊ะ** ไม่งั้น Zod fail)
- `FRONTEND_ORIGIN` → `http://localhost:5173` (default ของ Vite)
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` → จาก Cloudinary dashboard
- (optional) `GAME_END_AT` / `GAME_NOW_OVERRIDE` ถ้าจะเทสต์ time-up flow
- (optional) `SEED_CREATE_TEST_USER=true` — สร้าง QA fixture `TEST-AWARDS` (username `testawards`) แล้วผูกเป็น target ของ trivia card ทุกใบ ทำให้ scan ด้วย card อะไรก็ได้ outcome `match` เสมอ ปิดไว้เป็น default (อย่าเปิดใน prod)

> Login เป็น Azure Entra ID SSO — ค่า `CLIENT_ID` / `CLIENT_SECRET` / authority hardcode ไว้ใน `backend/src/lib/azureClient.ts` ไม่ได้อยู่ใน env ถ้าจะเปลี่ยน app registration ต้องแก้ไฟล์นั้นแล้ว rebuild redirect URI ที่ Azure portal ต้องมี `http://localhost:4000/api/auth/azure/callback` (dev) หรือ `https://<api-host>/api/auth/azure/callback` (prod)

ใช้ migration apply schema + seed:

```bash
# ครั้งแรกบน DB ว่าง:
npx prisma migrate deploy   # apply ทุก migration ใน prisma/migrations/
npm run seed                # อ่าน CSV → upsert พนักงาน + trivia cards + กระจาย assignedLeaderId
```

> ผู้เล่นไม่มี password — login ผ่าน Microsoft (Azure Entra ID) ด้วย email บริษัทครั้งแรก backend จะ match employee ด้วย email แล้วเขียน `azureOid` ลง row นั้น (auto-link)
> Seed log จะพิมพ์จำนวน employee, จำนวน leader, summary `assignedLeaderId` distribution, และ warning ถ้า target id ใน trivia CSV ไม่ตรงกับ employee CSV

รัน dev server:

```bash
npm run dev   # tsx watch + pino-pretty logs, listen 0.0.0.0:4000
```

ตรวจ health: `curl http://localhost:4000/health` → `{"ok":true}`
Swagger UI: http://localhost:4000/docs

### 3. Frontend

เปิด terminal ใหม่:

```bash
cd frontend
npm install
```

สร้างไฟล์ `.env.local` (Vite อ่าน env แค่ build-time / dev-time):

```env
VITE_API_BASE=http://localhost:4000/api
VITE_WS_BASE=ws://localhost:4000/api
```

> ใน prod ต้องเป็น `https://` และ `wss://` — ดู `DEPLOY.md`

รัน:

```bash
npm run dev   # Vite ที่ http://localhost:5173
```

เปิด browser ไป http://localhost:5173 (เปิดบนมือถือก็ได้ถ้าใช้ ngrok / LAN IP — เกมเป็น mobile-first)

### 4. Login + เดิน golden path

ผู้ใช้ทั้งหมดมาจาก `Employee Data.csv` ที่ user เตรียมเอง (PII, ไม่อยู่ใน repo) — `email` ของ employee คือคีย์ที่ Azure SSO ใช้ link ครั้งแรก (lowercase) login ไม่ต้องใส่รหัสอะไร แค่กดปุ่ม "Sign in with Microsoft" แล้วใช้ account อีเมลบริษัทของพนักงาน ดู id/email/leader status ที่ใช้เทสได้จาก:

- log ของ `npm run seed` (แสดงจำนวน employee + leader + distribution)
- คิวรี Postgres ตรงๆ:
  ```sql
  SELECT id, username, name, year, "isLeader", "leaderClue" FROM "Employee" ORDER BY "isLeader" DESC, id;
  ```
- ถ้าตั้ง `SEED_CREATE_TEST_USER=true` ก็มี QA user `testawards` (id `TEST-AWARDS`) ผูกเป็น target บน trivia card ทุกใบ ใช้เทส flow `match` ได้สะดวก

ลำดับเล่น:
1. `/login` → username + password
2. `/missions` → เลือก Trivia หรือ Teammate
3. **Trivia**: ดู cards ที่ได้ → `/missions/trivia/cards` → เลือก card → กด scan → เปิดกล้อง scan QR ของคนที่คิดว่าใช่
4. **Teammate**: ดู `leaderClue` (จาก leader ที่ระบบ assign ให้) + cohort ของตัวเอง → scan QR ของเพื่อน/leader → ระบบเช็ค cohort + `assignedLeaderId` + leader-clash + slot full
5. ถ้า scan ผ่าน (outcome `chat`) → `/chat/:pairId` ตอบคำถาม → confirm → slot ถูกเพิ่ม
6. ถ้า scan ผิดใน Trivia → ไป `/result/fail/:pairId` (target อัปโหลดรูปยืนยัน)
7. เมื่อครบ 10 quests → `/complete` (call `POST /completion` idempotent)

---

## Commands cheat sheet

### Backend (รันใน `backend/`)
| Command | คำอธิบาย |
|---|---|
| `npm run dev` | tsx watch + pretty logs |
| `npm run typecheck` | `tsc --noEmit` (ไม่มี linter — นี่คือ gate เดียว) |
| `npm run build` | `prisma generate && tsc -p tsconfig.json` → `dist/` |
| `npm start` | prod: `prisma migrate deploy && node dist/server.js` |
| `npm run prisma:migrate -- --name <name>` | สร้าง migration ใหม่ |
| `npm run prisma:reset` | ล้าง DB + apply migration ใหม่ (ต้อง `npm run seed` ตามด้วย) |
| `npm run seed` | อ่าน CSV → upsert seed data |
| `npm run wipe` | ล้างข้อมูลแบบไม่ drop schema |

### Frontend (รันใน `frontend/`)
| Command | คำอธิบาย |
|---|---|
| `npm run dev` | Vite dev server :5173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc --noEmit && vite build` → `dist/` |
| `npm run preview` | preview production build local |
| `npm run lhci` | Lighthouse CI (config ใน `lighthouserc.json`) |

---

## Architecture highlights

> เอกสาร architecture แบบเต็มอยู่ใน `CLAUDE.md` (root), `backend/CLAUDE.md` และ `frontend/CLAUDE.md`. ส่วนนี้แค่สรุป

### Backend
- **HTTP routes** ทั้งหมดอยู่ใต้ `/api` ยกเว้น `/health` และ `/docs`
- **Auth** ใช้ `@fastify/secure-session` cookie `jp_sess` (8h) — เปลี่ยน `SameSite=None; Secure` อัตโนมัติเมื่อ `FRONTEND_ORIGIN` เป็น https
- **WebSocket** 2 channel:
  - `/api/ws/pair/:pairId` — penalty page subscribe เพื่อ sync state สองฝั่ง
  - `/api/ws/user` — push notification ไปหา user (`pair.created`, `trivia.found`, `penalty.update`, `game.ended`)
- **WS hub เป็น in-process Map** — restart = state หาย, scale > 1 replica = broadcast ไม่ถึงกัน (ต้องเพิ่ม Redis/NATS backplane ก่อน)
- **Domain core** อยู่ใน `src/domain/scan.ts::processScan` — **9 outcome variants**: `match`, `mismatch`, `chat`, `wrong_year`, `wrong_leader`, `leader_clash`, `already_added`, `leader_full`, `teammate_full` (mirror 3 ที่: `shared/types.ts`, `scan.ts` local type, `frontend/src/types/game.ts`)
- **Teammate slot write ถูกเลื่อน** ไปที่ `POST /chat/:pairId/confirm-teammate` — `processScan` แค่สร้าง pair + audit row, ส่วน `addTeammateSlot` ทำงานหลัง user ตอบ chat-question แล้ว (กันการ skip step)
- **Pair.id** = `sha256(sortedIds + ':' + kind + ':' + UTCdayBucket).slice(0,16)` — pair หมุนใหม่ทุก UTC midnight
- **Trivia card → targets** เป็น **many-to-many** (`_TriviaCardTargets`) — card ใบเดียวมี answer ได้หลายคน
- **Routes ที่เพิ่มเข้ามา**: `GET /me/criteria` (clue ของทุก card ที่ผู้เล่นเป็น target ใช้แสดงบน profile ว่า "คนอื่นกำลังตามหาอะไรในตัวคุณ"), `GET /me/progress` ส่ง `leaderClue` กลับด้วย, `GET /missions/teammate/start` ส่ง `{ year, leaderClue }`

### Frontend
- **Single Zustand store** (`gameStore.ts`) persist key `journey-pass-5.5` v2
- **`GameShell`** = layout หลัก ห่อทุก route + ดูแล `ProgressDock` กับ `MyQRSheet`
- **`RequireAuth`** redirect ไป `/login` ถ้าไม่มี profile
- **Public projector routes** (`/memory`, `/ranking`) bypass auth + chrome
- **Scanner** ใช้ `html5-qrcode`, มี 3s debounce + manual fallback ("พิมพ์ ID")
- **Realtime path** = `useUserSocket` (user channel) ฟังแค่ `game.ended` + `pair.created` ของ trivia target เพื่อ trigger redirect ใน `GameShell`; UI notification (bell, auto-prompt) ถูกตัดออกแล้วเพราะงง — flow ทั้งหมดดันด้วย redirect แทน. `usePairSocket` สำหรับ `penalty.update` ในหน้า penalty
- **Path alias** `@/*` → `src/*` (ทั้ง backend + frontend tsconfig)

### Data model สำคัญ
- `Employee` — `id` คือ canonical, `username` lowercase, `isLeader` flag, `leaderClue: String?` (clue ที่ใช้แสดงให้ผู้เล่นที่ถูกผูกกับ leader คนนี้)
- `TriviaCard` — many-to-many กับ `Employee` ผ่าน relation `TriviaCardTargets` (join table โดยปริยาย `_TriviaCardTargets`)
- `Scan` — append-only audit log (enum DB มีแค่ `MATCH`/`MISMATCH`; 9 variants อยู่แค่ใน TS) — บาง outcome เช่น `already_added`, `leader_full`, `teammate_full`, `wrong_leader`, `leader_clash` **ไม่ลง row** เป็น silence ตั้งใจ
- `Pair` — drives realtime state (penalty + teammate confirm) 1 row ต่อ (sorted scanner+scanned, kind, UTC day) — fields: `targetConfirmed`, `proofPhotoUrl`, `penaltyKey` (ไม่มี `hunterConfirmed` แล้ว — penalty เป็น one-sided photo upload)
- `PlayerProgress` — JSON columns: `triviaStamps`, `teammateSlots` (cap 6 = 5 non-leader + 1 optional leader, **enforce in code ไม่ใช่ schema** ผ่าน `pg_advisory_xact_lock`), `assignedCardIds` (5 card ที่ถูกล็อก), `assignedLeaderId` (leader ที่ระบบกำหนดให้, leader-player เป็น `null`), `completedAt`, `updatedAt`

---

## Deployment

| Doc | Use case |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | Railway (backend + Postgres) + Vercel (frontend) — สำหรับ testing/staging |
| [`DEPLOY-INFRA.md`](DEPLOY-INFRA.md) | Company infrastructure checklist + คำถามที่ต้องถาม DevOps ก่อน deploy production |

หลัก ๆ คือ:
1. Provision Postgres + gen `SESSION_SECRET`
2. ตั้ง env vars ทุกตัวใน `backend/.env.example`
3. `npm run build && npm start` (จะรัน `prisma migrate deploy` ก่อน listen)
4. Seed ครั้งแรก: `npm run seed` ใน environment ที่มี CSV + DATABASE_URL ของ prod
5. Deploy frontend static (ต้อง fallback `index.html` สำหรับ SPA + proxy `/api/*` รวมถึง WebSocket upgrade)

> **Hot tip**: `npm start` รัน `prisma migrate deploy` แต่ถ้า DB ของคุณเคยใช้ `db push` มาก่อน (table ครบแต่ `_prisma_migrations` ว่าง) ครั้งแรกจะ fail "relation already exists" — ดูวิธี baseline ใน `DEPLOY.md` section 1.4

---

## Troubleshooting

| ปัญหา | สาเหตุ / วิธีแก้ |
|---|---|
| Login 401 ทุก user | ลืม `npm run seed` หลัง migrate — Postgres ว่าง |
| `Invalid environment` แล้ว exit 1 | env validate ผ่าน Zod ที่ boot — เช็ค `SESSION_SECRET` ยาวเป๊ะ 64 hex chars |
| Cookie ไม่ติด cross-site (prod) | `NODE_ENV=production` + ทั้ง frontend/backend ต้อง https + `FRONTEND_ORIGIN` ตรง exact (no trailing slash) |
| WS connect fail | ใช้ `wss://` (ไม่ใช่ `ws://`) ใน prod, path `/api/ws/pair/:id` หรือ `/api/ws/user` |
| Build fail บน Linux เพราะ Prisma OpenSSL | เช็ค `binaryTargets` ใน `prisma/schema.prisma` — default มี `["native", "debian-openssl-3.0.x"]` |
| Camera ไม่เปิด | ต้อง https (ยกเว้น localhost) — ใช้ ngrok ตอนเทส LAN |
| QR scan แล้วไม่ตอบสนอง | scanner มี 3s debounce ของ payload เดิม — ลอง scan QR คนอื่นแทรก หรือใช้ปุ่ม "พิมพ์ ID" |
| Teammate scan ผ่านแต่ slot ไม่ขึ้น | ต้องไป `/chat/:pairId` ตอบคำถาม + confirm ก่อน — slot write ถูกเลื่อนจาก `POST /scans` ไปที่ `POST /chat/:pairId/confirm-teammate` |
| Scan leader แล้วเด้ง `wrong_leader` ทุกคน | ต้อง scan **leader ที่ระบบ assign ให้** เท่านั้น (`assignedLeaderId` กระจายตอน seed) — ดูได้จาก `GET /missions/teammate/start` หรือ `GET /me/progress` ที่ส่ง `leaderClue` กลับมา |

---

## Reference docs

อ่านควบคู่:

- [`CLAUDE.md`](CLAUDE.md) — architecture overview ทั้ง monorepo
- [`backend/CLAUDE.md`](backend/CLAUDE.md) — gotchas ของ backend ที่ source code ไม่บอก
- [`frontend/CLAUDE.md`](frontend/CLAUDE.md) — router / store / scanner / notification stack
- [`backend/scripts/README.md`](backend/scripts/README.md) — วิธีรับ CSV
- [`DEPLOY.md`](DEPLOY.md) — Railway + Vercel
- [`DEPLOY-INFRA.md`](DEPLOY-INFRA.md) — production deploy checklist
- `backend/src/config.ts` — env schema (source of truth)
- `backend/prisma/schema.prisma` — DB schema
- `shared/types.ts` — cross-cutting domain types

---

## License

Private — internal project ไม่เปิดเผยภายนอก ห้าม commit ไฟล์ CSV ที่มี PII
