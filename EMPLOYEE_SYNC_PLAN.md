# Employee Sync — Plan (next-up task)

**เป้าหมายใหม่ (phase 1):** ทิ้ง CSV ทั้งหมด → bootstrap ผ่าน HR API + admin UI ล้วน

ไฟล์ CSV ทั้ง 3 ตัว (`Employee Data.csv`, `Teamlead.csv`, `TriviaQuestion AndTarget.csv`) จะถูกลบออกจาก flow production. Initial roster มาจาก HR API; leader flag, leader clue, trivia card + targets, leader assignment — admin จัดการผ่านหน้าที่มีอยู่แล้ว (`/admin/employees`, `/admin/trivia`)

## Goal

- Admin กด **"ซิงก์จาก HR API"** ครั้งเดียวเพื่อ bootstrap roster ก่อน event
- หลังจากนั้น admin toggle leader / กรอก leader clue / สร้าง trivia card + assign targets / กด "auto-distribute leaders" ครั้งเดียว → พร้อม run event
- รองรับ re-sync ระหว่าง event (add / update / report missing) โดยไม่ทำลาย game state ของผู้เล่นที่กำลังเล่น
- ลบ dependency ของ PII CSV จาก deploy artifact

## Open questions — ต้องเคลียร์ก่อนเริ่มเขียน

1. **API endpoint + auth** — URL, header, token, env var name (เช่น `HR_API_URL`, `HR_API_TOKEN`)?
2. **Field mapping** — API ส่ง field อะไรบ้าง? ต้อง map กับ schema นี้:
   - `id` (canonical, immutable, FK target ทั่วทั้ง schema) ← ?
   - `email` (load-bearing สำหรับ Azure SSO match) ← ?
   - `name`, `nickname`, `position`, `dept` ← ?
   - `year` (ปีที่เริ่มงาน, ใช้ใน `inSameYearGroup` cohort cutoff 2023) ← ?
   - `birthMonth` (1–12) ← ?
   - `isLeader` ← API ส่งให้ได้ไหม? ถ้าไม่ได้ admin toggle เองใน `/admin/employees` (ไฟน์ — มี CRUD อยู่แล้ว)
   - `leaderClue` ← admin กรอกเองแน่นอน (ไม่ใช่ HR data)
3. **คนลาออก/พ้นสภาพ ระหว่าง event** — แนะนำ phase 1: **report เฉยๆ** (`missingInApi`) ไม่แตะ DB. ถ้า volume เยอะค่อยขยับเป็น soft-delete (เพิ่ม `Employee.active`) phase 2

## Bootstrap flow (event ใหม่ — ไม่มี CSV)

ลำดับขั้นที่ admin ต้องทำก่อน open event:

1. **Sync employees** — กดปุ่มในหน้า `/admin/employees` → ดึงทุก row จาก HR API → DB
2. **Set leaders** — toggle `isLeader=true` สำหรับ ~5-10 คน (มี filter `role=leader` อยู่แล้ว)
3. **Set leader clues** — กรอก `leaderClue` ให้ leader ทุกคน (มี field อยู่แล้วใน edit form)
4. **Auto-distribute leaders** — กดปุ่มใหม่ "กระจาย leader ให้ผู้เล่น" → backend run greedy algorithm (ย้ายมาจาก `seed.ts`) → เขียน `assignedLeaderId` ให้ non-leader ทุกคน
5. **Create trivia cards** — ใช้ `/admin/trivia` สร้างการ์ด + กรอก clue + assign targets (มี CRUD อยู่แล้ว)
6. **Open event** — `gameEndAt` คุมจาก env / ปุ่ม `POST /admin/game/end-now` มีอยู่แล้ว

ChatQuestion + Penalty ไม่กระทบ — seed มาจาก migration อยู่แล้ว (`20260507020000_chat_questions_and_answers`, `20260507030000_penalty_table`) ไม่เคยใช้ CSV

## Scope

### Backend

**ใหม่: `backend/src/lib/hrApi.ts`**
- `fetchEmployeesFromHr(): Promise<HrEmployee[]>`
- จัดการ auth header, retry (1-2 ครั้ง), timeout (default 15s)
- Map HR API shape → internal shape ที่ตรงกับ Prisma `Employee`
- Throw error message ที่ชัดเจน (แยก 401/403 vs 5xx vs network/timeout) เพื่อให้ admin UI แสดงต้นเหตุได้

**ใหม่: `backend/src/domain/employeeSync.ts`**
- `syncEmployees(): Promise<SyncResult>`:
  ```ts
  type SyncResult = {
    added: { id: string; name: string }[];
    updated: { id: string; name: string; changedFields: string[] }[];
    missingInApi: { id: string; name: string }[];
    errors: { id?: string; reason: string }[];
    fetchedAt: string; // ISO
  };
  ```
- Logic:
  1. Fetch จาก API
  2. Load `Employee` ปัจจุบันทั้งหมด
  3. Diff โดยใช้ `id` เป็น immutable join key:
     - มีใน API + ไม่มีใน DB → **add** (`prisma.employee.create`) — set `isLeader=false`, `leaderClue=null` (admin จัดการเอง)
     - มีทั้งสองข้าง + ฟิลด์ที่ HR เป็นเจ้าของต่างกัน → **update** (`prisma.employee.update`) — **ห้ามแตะ** `id`, `isLeader` (เว้นแต่ HR ส่งมา), `leaderClue`, `azureOid`
     - มีใน DB + ไม่มีใน API → **missingInApi** (รายงานเฉยๆ phase 1)
  4. Wrap ใน `prisma.$transaction` เพื่อ atomicity
  5. เรียก `invalidateEmployeeCache()` หลัง commit
  6. Return summary

**ใหม่: `backend/src/domain/leaderDistribution.ts`**
- ย้าย greedy distribution algorithm ออกจาก `seed.ts` มาเป็น standalone function
- `redistributeLeaders(): Promise<{ assigned: number; leadersUsed: { id: string; name: string; assignedCount: number }[] }>`
- ทำงานในธุรกรรม + เรียก `invalidateEmployeeCache()` (เผื่อกระทบ cache)
- **อย่ารัน mid-event** ถ้ามีผู้เล่นเก็บ leader stamp ไปแล้ว (จะกลายเป็น `wrong_leader`). ปุ่มต้องมี confirm warning

**Routes ใหม่ใน `backend/src/routes/admin.ts`** (ส่วน `─── Employees ───`):
```ts
app.post('/admin/employees/sync', async (_req, reply) => {
  try {
    return await syncEmployees();
  } catch (err) {
    return reply.code(502).send({ error: 'hr_api_failed', message: String(err) });
  }
});

app.post('/admin/employees/redistribute-leaders', async () => {
  return await redistributeLeaders();
});
```
- Gated ผ่าน `requireAdmin` อัตโนมัติ
- Rate limit default (300/min) เพียงพอ — ไม่ต้องกดถี่อยู่แล้ว

**Env vars เพิ่ม** ใน `backend/src/config.ts` (Zod schema):
- `HR_API_URL` — required string
- `HR_API_TOKEN` — required string
- (Optional) `HR_API_TIMEOUT_MS` — default 15000

**`backend/scripts/seed.ts` → ลด scope ลง**
- ลบ logic CSV ทั้งหมด (parser, employee/leader/trivia loaders, distribution pass)
- เหลือเฉพาะ:
  - Optional `TEST-AWARDS` test user (gated by `SEED_CREATE_TEST_USER=true`)
  - (พิจารณา) seed `dev-employees.json` ถ้า `NODE_ENV !== 'production'` และตาราง Employee ว่าง — ดูส่วน "Local dev" ด้านล่าง
- หลัง refactor: prod `npm start` ไม่ต้องเรียก `npm run seed` แล้ว (admin sync ทำให้แทน) — `DEPLOY.md` ต้อง update

**ลบไฟล์:**
- `backend/scripts/Employee Data.csv` (gitignored อยู่แล้ว — แค่ทิ้งจาก dev machine)
- `backend/scripts/Teamlead.csv`
- `backend/scripts/TriviaQuestion AndTarget.csv`
- `backend/scripts/README.md` ปรับให้สะท้อนว่า CSV หมดบทบาท

### Frontend

**`frontend/src/api/endpoints.ts`** — เพิ่มใน `adminEndpoints`:
```ts
syncEmployees: () => api.post<SyncResult>('/admin/employees/sync'),
redistributeLeaders: () => api.post<RedistributeResult>('/admin/employees/redistribute-leaders'),
```
+ export `SyncResult` + `RedistributeResult` ให้ตรงกับ backend

**`frontend/src/features/admin/AdminEmployees.tsx`** (ที่มีอยู่แล้ว) — เพิ่ม:
- ปุ่ม "ซิงก์จาก HR API" ใน header
- ปุ่ม "กระจาย leader" (มี confirm dialog เตือนว่าจะ overwrite `assignedLeaderId` ทั้งหมด)
- ตอนกด: disable + spinner
- เสร็จแล้ว: render summary card (added / updated / missing / errors / fetchedAt) + reload table
- เมื่อ `Employee` table ว่าง (first-run state) → แสดง empty state ใหญ่ๆ ที่มี "ซิงก์จาก HR API" เป็น CTA หลัก แทน table ว่าง

**i18n keys ใหม่** ใน `frontend/src/lib/i18n/locales/{en,th}.ts`:
- `admin.employees.sync.button`
- `admin.employees.sync.syncing`
- `admin.employees.sync.added` / `updated` / `missing` / `errors`
- `admin.employees.sync.error` / `errorAuth` / `errorTimeout`
- `admin.employees.redistribute.button`
- `admin.employees.redistribute.confirm` — เตือนเรื่องผู้เล่นที่ stamp leader ไปแล้ว
- `admin.employees.redistribute.success` — "กระจาย leader ให้ {count} คน"
- `admin.employees.empty.title` / `admin.employees.empty.cta` — empty state

### Local dev (ไม่มี HR API token)

ปัญหา: `DEV_LOGIN_ENABLED=true` ใช้ employee picker — ถ้า DB ว่าง dev ไม่มีคนให้เลือก

**ทางเลือก (recommended):** สร้าง `backend/scripts/dev-employees.json` (commit ได้ — ข้อมูลปลอม) ~10 คน รวม 2 leader. `seed.ts` โหลดไฟล์นี้เมื่อ `NODE_ENV !== 'production'` และตาราง Employee ว่าง. Production sync จาก HR API เสมอ — ไม่ใช้ไฟล์นี้

```jsonc
// backend/scripts/dev-employees.json
[
  { "id": "DEV-001", "name": "Dev Leader A", "nickname": "Lead-A",
    "email": "leadA@dev.test", "position": "Eng Lead", "dept": "Eng",
    "year": 2020, "birthMonth": 3, "isLeader": true, "leaderClue": "ใส่แว่นกรอบดำ" },
  // ...
]
```

ข้อดี: ไม่มี PII, commit ได้, dev clone repo แล้ว `npm run seed` ใช้ได้เลย ไม่ต้องขอ HR token

**ทางเลือกสำรอง:** dev สร้าง employee เองผ่าน `/admin/employees` UI (มี POST CRUD อยู่แล้ว) — ใช้ได้แต่เสียเวลาทุก reset

## Migration / rollout sequence

ลำดับการ ship phase 1 (เพื่อไม่ให้ event ที่กำลังจะมาถึงพัง):

1. **Build sync infrastructure** (backend + frontend) — แต่ยังไม่ลบ CSV path ใน `seed.ts`
2. **Manual smoke test** บน staging — sync จริงเข้า DB เปล่า, verify employee count + field shape ถูกต้อง
3. **Run sync บน prod DB** ครั้งแรกเพื่อตรวจ — เทียบกับ CSV เดิมว่ามีคนตรงกัน
4. **Admin set leaders + trivia targets** ผ่าน UI (test ว่า workflow ใช้ได้จริง)
5. **Auto-distribute leaders** — verify ว่ากระจายตรงกับสิ่งที่ seed.ts เคยทำ
6. **เปลี่ยน `npm start`** ให้ไม่เรียก seed (หรือ seed ทำเฉพาะ test user)
7. **ลบ CSV files + ลบ CSV loaders จาก seed.ts** — commit แยก เพื่อ revert ง่ายถ้าเจอปัญหา
8. **Update docs:** `CLAUDE.md` (root) + `backend/CLAUDE.md` + `DEPLOY.md` + `backend/scripts/README.md`

## Edge cases

1. **`Employee.id` ห้ามเปลี่ยน** — FK ลิงก์ไปหมด (PlayerProgress, Pair, Scan, Stamp, Slot, Memory, Assignment). Sync ใช้ `id` เป็น **immutable join key** เท่านั้น
2. **`leaderClue` / `azureOid` ห้ามทับ** ตอน update — admin/SSO callback เป็นเจ้าของ
3. **`isLeader` flip mid-game** — ถ้า HR API ส่ง `isLeader` มาแล้วเปลี่ยน:
   - กระทบ `assignedLeaderId` ของผู้เล่นคนอื่น (ชี้ไปยังคนที่ไม่ใช่ leader แล้ว)
   - กระทบ `wrong_leader` / `leader_clash` ใน `processScan`
   - แนะนำ phase 1: **อย่า auto-update `isLeader` จาก HR API** — admin toggle เองดีกว่า (ปุ่ม sync แค่รายงานว่า "API บอก person X เป็น leader/non-leader แต่ DB ไม่ตรง")
4. **Email ซ้ำ** — ถ้า API ส่ง email ที่ซ้ำกับ row อื่นใน DB ให้ skip + report error (ไม่ทำให้ batch ทั้งก้อน fail)
5. **Year/birthMonth เปลี่ยน** — กระทบ `inSameYearGroup` ของรอบที่กำลังเล่น. Update ตามจริงแต่รายงานใน UI
6. **HR API ล้ม/ช้า** — timeout 15s, return 502 + frontend แสดง toast ผ่าน `useErrorStore` (`describeHttpError` ครอบคลุม 5xx)
7. **Cache** — หลัง sync **ต้อง** เรียก `invalidateEmployeeCache()` ไม่งั้นรอ 60s
8. **Redistribute leaders mid-event** — ถ้ามีผู้เล่น stamp leader ไปแล้ว ปุ่มนี้จะทำให้คนนั้น "หาย" leader เดิม. ใส่ confirm dialog เตือนชัดเจน
9. **Initial run บน DB ว่าง** — sync เข้า empty table → ทุกคนเป็น `isLeader=false`. Admin ต้อง toggle leader ก่อนกด "redistribute" ไม่งั้นจะไม่มี leader ให้กระจาย

## Implementation checklist

- [ ] **0. เคลียร์ open questions** — DevOps/HR เรื่อง URL, auth, field shape, รวมถึงว่า API ส่ง `isLeader` มาด้วยไหม
- [ ] **1. Backend — HR client** (`lib/hrApi.ts`) + env validation ใน `config.ts`
- [ ] **2. Backend — sync domain** (`domain/employeeSync.ts`)
- [ ] **3. Backend — leader distribution** (`domain/leaderDistribution.ts` ย้ายมาจาก `seed.ts`)
- [ ] **4. Backend — admin routes** (sync + redistribute) + Swagger
- [ ] **5. Manual test** — curl/Postman เทียบ summary กับสภาพ DB จริง
- [ ] **6. Frontend — endpoint wrappers** + types
- [ ] **7. Frontend — UI ใน `AdminEmployees`** (sync button, redistribute button, summary card, empty state) + i18n keys
- [ ] **8. Local dev fixture** — `dev-employees.json` + `seed.ts` โหลดเมื่อ NODE_ENV != production
- [ ] **9. End-to-end test** — bootstrap จากศูนย์: sync → toggle leaders → set clues → redistribute → create trivia → run game
- [ ] **10. ลบ CSV path** — drop loaders ใน `seed.ts`, ลบ 3 CSV files, update `scripts/README.md`
- [ ] **11. Update docs** — `CLAUDE.md` (root), `backend/CLAUDE.md`, `DEPLOY.md`
- [ ] **12. Phase 2 decisions** — soft-delete column? auto cron sync? auto-update `isLeader` จาก HR?

## Files

**ใหม่:**
- `backend/src/lib/hrApi.ts`
- `backend/src/domain/employeeSync.ts`
- `backend/src/domain/leaderDistribution.ts`
- `backend/scripts/dev-employees.json`

**แก้:**
- `backend/src/config.ts` — เพิ่ม HR_API_* env vars
- `backend/src/routes/admin.ts` — เพิ่ม 2 routes
- `backend/scripts/seed.ts` — ลบ CSV loaders, เหลือ test user + dev fixture loader
- `backend/scripts/README.md` — สะท้อนว่า CSV เลิกใช้
- `frontend/src/api/endpoints.ts` — เพิ่ม wrappers + types
- `frontend/src/features/admin/AdminEmployees.tsx` — UI ใหม่ + empty state
- `frontend/src/lib/i18n/locales/en.ts` + `th.ts` — keys ใหม่
- `CLAUDE.md` (root) — note ว่า roster มาจาก HR API, ไม่มี CSV
- `backend/CLAUDE.md` — update seed section, ลบ "requires three CSVs"
- `DEPLOY.md` — ลบ step `npm run seed` post-migrate (หรือเปลี่ยนเป็น "first-time admin sync")

**ลบ:**
- `backend/scripts/Employee Data.csv`
- `backend/scripts/Teamlead.csv`
- `backend/scripts/TriviaQuestion AndTarget.csv`

## Out of scope (phase 1)

- **Auto cron sync** — ไว้ทำหลัง manual sync เสถียร (อาจจะ daily 02:00 Bangkok)
- **Soft-delete `Employee.active`** — ตอนนี้ report missing เฉยๆ พอ
- **Auto-update `isLeader` จาก HR API** — เสี่ยงพังเกมกลางทาง, admin toggle เองปลอดภัยกว่า
- **Auto-create trivia card targets จาก HR field** — HR API ไม่น่ามีฟิลด์นี้, admin assign เองใน `/admin/trivia`
- **Replace SSO email match ด้วย azureOid** — ยังใช้ email ตามเดิม (ตามที่ระบุใน `routes/auth.ts`)
