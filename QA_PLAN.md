# QA Plan — Unit Testing

> เอกสารนี้ใช้ track progress ของการทำ Unit Test สำหรับโปรเจกต์นี้
> สร้างเมื่อ 2026-05-11 — tick checkbox เมื่อ test ของแต่ละข้อเขียน + pass แล้ว

---

## 0) Setup & Tooling

### Backend (`backend/`)
- [x] ติดตั้ง dev deps: `vitest @vitest/coverage-v8 vite-tsconfig-paths` *(mock-extended เลื่อนไป Phase 3)*
- [x] สร้าง `backend/vitest.config.ts` (plugins: `tsconfigPaths()`, environment: `node`, env vars ครบสำหรับ `config.ts` Zod)
- [x] เพิ่ม scripts ใน `backend/package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`
- ⏭ สร้าง `backend/tests/fixtures/prisma-mock.ts` (`mockDeep<PrismaClient>()`) — *DECIDED NOT TO DO: Phase 3 ใช้ manual Prisma mock (vi.hoisted + plain object) แทน, ไม่ต้องติดตั้ง `vitest-mock-extended`*
- [x] ยืนยันว่า `npm test` รันได้ (27/27 ผ่าน)

### Frontend (`frontend/`)
- [x] ติดตั้ง dev deps: `vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`
- [x] เพิ่ม `test` section ใน `frontend/vite.config.ts` (environment: `jsdom`, globals: true, setupFiles)
- [x] สร้าง `frontend/src/test/setup.ts` (`import '@testing-library/jest-dom'` + cleanup + localStorage.clear)
- [x] เพิ่ม scripts ใน `frontend/package.json`: `"test"`, `"test:watch"`, `"test:coverage"`
- [x] ยืนยัน `npm test` (26/26 ผ่าน)

### CI — **OUT OF SCOPE (per user instruction)**
- ⏭ เพิ่ม `.github/workflows/test.yml` รัน `typecheck` + `test` ทั้ง backend และ frontend *(ผู้ใช้สั่งไม่แตะ infra)*
- ⏭ เพิ่ม pre-commit hook รัน `vitest related --run` บน staged files *(optional + out of scope)*

---

## Phase 1 — Pure Functions (P0, ROI สูงสุด) — **DONE** ✅

### `backend/src/domain/pairId.test.ts` (6 tests)
- [x] TRIVIA symmetric: `pairId('A','B','TRIVIA')` === `pairId('B','A','TRIVIA')`
- [x] TEAMMATE directional: `pairId('A','B','TEAMMATE')` !== `pairId('B','A','TEAMMATE')`
- [x] Cross-kind isolation: TRIVIA pair ≠ TEAMMATE pair (A/B/วันเดียวกัน)
- [x] Day bucket rollover: pairId วันที่ต่างกันต้องต่าง
- [x] **UTC midnight boundary** ⚠️: `2026-05-11` vs `2026-05-12` → คนละ pairId
- [x] Output length = 16 hex chars เสมอ

### `backend/src/lib/gameClock.test.ts` (7 tests)
- [x] `gameNow()` คืนค่าจาก `GAME_NOW_OVERRIDE` เมื่อ set
- [x] `gameNow()` คืน real Date เมื่อไม่ set
- [x] `gameEndAt()` default = BKK 17:00 ของวันนั้น
- [x] **BKK +07:00 boundary** ⚠️: `gameNow=2026-05-11T18:00:00Z` (=01:00 BKK 12 พ.ค.) → endAt ของ 12 พ.ค.
- [x] `gameEndAt()` คืน `GAME_END_AT` override เมื่อ set
- [x] `isGameEnded()` true เมื่อ now >= endAt (รวม exact tick)
- [x] `isGameEnded()` false เมื่อ now < endAt

### `backend/src/domain/scan.helpers.test.ts` (14 tests)
- [x] `inSameYearGroup(2022, 2021)` → true (both senior cohort)
- [x] `inSameYearGroup(2022, 2023)` → false (boundary)
- [x] `inSameYearGroup(2023, 2024)` → false (different exact year)
- [x] `inSameYearGroup(2023, 2023)` → true
- [x] `inSameYearGroup(2019, 2018)` → true (deep senior)
- [x] Symmetric: a vs b === b vs a
- [x] `toEmployeeShape`: `initial` = name.charAt(0)
- [x] `toEmployeeShape`: `isLeader` default false เมื่อไม่ pass
- [x] `toEmployeeShape`: `isLeader=true` preserved
- [x] `toEmployeeShape`: `isLeader=false` explicit
- [x] `toEmployeeShape`: passes through id/name/dept/year/birthMonth
- [x] `toEmployeeShape`: empty name → empty initial

### `frontend/src/game/gameStore.test.ts` — Selectors (19 tests)
- [x] `selectTriviaDone` นับเฉพาะ stamps (+ 0 case)
- [x] `selectTeammateDone` นับเฉพาะ non-null slots (ไม่รวม leaderSlot, + 0 case)
- [x] `selectIsComplete`: 5 stamps + 5 slots → true
- [x] `selectIsComplete`: 5 stamps + 4 slots + 1 leader → **false** (CRITICAL — leader ไม่นับ)
- [x] `selectIsComplete`: partial progress → false
- [x] `selectCurrentTriviaCardId` คืน first un-stamped ตาม order
- [x] `selectCurrentTriviaCardId` คืน null เมื่อ stamped ครบ
- [x] `selectCurrentTriviaCardId` คืน first card เมื่อไม่มี stamp
- [x] `selectLastTeammateSlot` คืน slot สุดท้ายที่ไม่ใช่ null
- [x] `selectLastTeammateSlot` คืน null เมื่อทุก slot ว่าง
- [x] `selectLastTeammateSlot` full → คืน slot สุดท้าย
- [x] `selectIsGameEnded` false เมื่อ null, true เมื่อ set
- [x] `reset()` กลับ emptyState
- [x] `formatYearGroup(2022)` → 'pre-2023'
- [x] `formatYearGroup(2023)` → 'Class of 2023'
- [x] `formatYearGroup(null/undefined)` → '—'

### `frontend/src/lib/routes.test.ts` (7 tests, bonus)
- [x] Static paths (welcome, user, missions, complete, timeUp, memoryWall, ranking, ...)
- [x] `triviaScan(cardId)` builder
- [x] `fail(pairId)` builder
- [x] `chatConfirm(pairId)` builder
- [x] `success(ref)` URL-encodes (plain / slash+space / ampersand)

**Phase 1 Summary: 53 tests, 5 files, all passing. Backend typecheck + frontend typecheck ผ่าน**

---

## Phase 2 — Pure logic with state (P0/P1) — **DONE** ✅

### `frontend/src/game/gameStore.test.ts` — Actions (รวมกับ selectors เดิม)
- [x] `addTeammateSlot` เติม slot แรกที่ว่าง
- [x] `addTeammateSlot` append ลง slot ถัดไปตาม order
- [x] `addTeammateSlot` dedup (กดซ้ำ id เดิม no-op, ไม่มี duplicate)
- [x] `addTeammateSlot` block ถ้า employee อยู่ใน leaderSlot
- [x] `addTeammateSlot` no-op เมื่อ slots เต็ม 5
- [x] `addLeaderSlot` set ครั้งแรก ok
- [x] `addLeaderSlot` ครั้งที่สอง no-op (ไม่ overwrite)
- [x] `addLeaderSlot` กด leader เดิมซ้ำ no-op
- [x] `addLeaderSlot` block ถ้า employee อยู่ใน member slots
- [x] `hydrateProgress` แยก teammateSlots ตาม isLeader → leaderSlot + 5 slots + propagate year/clue/cards/stamps
- [x] `hydrateProgress` edge: 6+ non-leaders → slice เหลือ 5
- [x] `hydrateProgress` ไม่มี leader ใน payload → leaderSlot null
- [x] `hydrateProgress` propagate gameEndedAt
- [x] `setGameEnded` clear chatTarget, pendingPenalty, pendingChat, chatBothAnsweredFor, pairMemoryPhoto
- [x] `addTriviaStamp` write + overwrite
- [x] `markTriviaIntroSeen` / `markTeammateIntroSeen` / `markProfileCriteriaSeen` flip flags
- [ ] Persist version 7 — load ค่า version เก่าไม่ crash *(skip; Zustand persist ไม่มี migration callback ใน store นี้ — ไม่จำเป็นต้องเทสต์ runtime behaviour)*

### `backend/src/domain/chatQuestions.test.ts`
- [x] Determinism: pairId เดิม → question id เดิม (รันซ้ำ 10x)
- [x] Distribution sanity: 1000 pairId ต่าง → ครอบ ≥15 จาก 20 questions (ไม่ collapse)
- [x] Returns a member of the seeded pool
- [x] Cache TTL: 2 calls ใน 60s → DB hit 1 ครั้ง
- [x] Cache TTL: ทะลุ 60s → DB hit ใหม่
- [x] In-flight dedup: 10 concurrent calls ขณะ cache miss → loader 1 ครั้ง
- [x] Empty pool → throw with clear message
- [x] `invalidateChatQuestionCache` force re-read

### `backend/src/lib/ttlCache.test.ts`
- [x] TTL expiry: ใช้ fake timers — refresh หลัง TTL
- [x] Cache reuse ภายใน TTL (loader 1 ครั้ง)
- [x] `invalidate(key)` force re-load
- [x] `invalidate(unknown key)` no-op
- [x] Stampede prevention: 5 concurrent ขณะ miss → loader 1 ครั้ง
- [x] Loader throw → inflight ถูก clear, retry ถัดไปเรียก loader ใหม่
- [x] Different keys ไม่ block กัน

### `backend/src/middleware/auth.test.ts`
- [x] `requireSession` ไม่มี employeeId → 401 + `{error:'unauthenticated'}`
- [x] `requireSession` มี employeeId → ไม่ touch reply
- [x] `requireSession` empty string → 401 (falsy treatment)
- [x] `requireAdmin` ไม่มี flag → 401 + `{error:'admin_unauthenticated'}`
- [x] `requireAdmin` isAdmin=false → block
- [x] `requireAdmin` isAdmin="true" (string) → block (strict boolean check)
- [x] `requireAdmin` isAdmin=true → ผ่าน
- [x] `requireAdmin` มี employeeId แต่ไม่มี isAdmin → block (independence)

**Phase 2 Summary: เพิ่ม 43 tests, รวม 96 tests (backend 51 + frontend 45). Typecheck ผ่านทั้งคู่**

---

## Phase 3 — `processScan` 9-Branch Matrix (P0 CRITICAL) — **DONE** ✅

> Test file: `backend/src/domain/scan.processScan.test.ts`
> Mocks: `@/db/prisma.js`, `@/lib/employeeCache.js`, `@/lib/triviaCardCache.js`, `@/lib/penaltyCache.js`, `@/ws/hub.js`, `@/lib/gameClock.js`
> Pattern: `vi.hoisted` สร้าง prisma + cache mocks; `$transaction` callback ใช้ prismaMock เป็น tx → bare/transactional calls ใช้ surface เดียวกัน

### Trivia mode (5 cases)
- [x] **match**: scannedId in card.targetIds → TriviaStamp upsert + Scan(MATCH) + broadcast `trivia.found` ไปที่ target + bump PlayerProgress.updatedAt
- [x] **mismatch — new round, no prior pair**: pair create, TriviaPenalty create กับ penaltyId, Scan(MISMATCH), broadcast `pair.created` ทั้งสองฝั่ง (`hunter` + `target` role)
- [x] **mismatch — new round, prior confirmed**: existing.triviaPenalty.targetConfirmed=true → pair.update hunter/target, roll penalty ใหม่
- [x] **mismatch — direction flipped** ⚠️: existing.hunterId !== scannerId → hunter/target swap, broadcast STILL fires
- [x] **mismatch — same round re-scan** ⚠️: targetConfirmed=false, same hunter → NO penalty roll, NO hunter swap, **broadcast STILL fires** (CLAUDE.md ห้าม gate)

### Pre-flight (3 cases)
- [x] **GameEnded**: mock isGameEnded → true → throw GameEndedError, NO DB / cache call
- [x] **NotFound target**: employeeCache คืน array ไม่มี target → throw NotFoundError
- [x] **NotFound scanner**: employeeCache คืน array ไม่มี scanner → throw NotFoundError
- [x] **NotFound card**: getTriviaCard คืน null → throw NotFoundError

### Teammate mode (8 cases)
- [x] **wrong_year**: non-leader vs non-leader, year ต่าง, ทั้งคู่ >= 2023 → Scan(MISMATCH, TEAMMATE, **no pairId**), NO broadcast
- [x] **wrong_year boundary**: scanner.year=2022, target.year=2021 → outcome `chat` (senior cohort match)
- [x] **wrong_leader**: target.isLeader, scanner มี assignedLeaderId, target!=assigned → **no audit row**, no broadcast
- [x] **leader_clash**: ทั้งคู่ isLeader → no audit row, no broadcast
- [x] **already_added**: scannedId อยู่ใน slots แล้ว → no audit row, no broadcast
- [x] **leader_full**: target.isLeader, scanner มี leader slot → no row
- [x] **teammate_full**: non-leader target, non-leader count=5 → no row
- [x] **chat (success)**: non-leader, year ok, slot ว่าง → Pair upsert (TEAMMATE), Scan(MATCH), broadcast เฉพาะ target side, **NO teammateSlot.create** (slot writes ที่ /chat/:pairId/confirm-teammate)
- [x] **chat for leader**: target.isLeader, scanner.assignedLeaderId === target.id, year ข้าม cohort → outcome `chat` (year check bypassed)

### `addTeammateSlot` (cap enforcement, 8 cases)
- [x] Add ใหม่ → row created, return true, updatedAt bumped
- [x] Duplicate id → return false, no insert, no updatedAt
- [x] 5 non-leaders + add leader → return true (5+1 = 6 total ok)
- [x] 5 non-leaders + add non-leader → return false (cap hit)
- [x] มี leader แล้ว + add another leader → return false
- [x] 4 non-leaders + 1 leader + add non-leader → return true (fill slot 5)
- [x] Advisory lock SQL ถูกเรียก: `$executeRaw` call detected
- [x] updatedAt bump เมื่อ added=true เท่านั้น (verified ใน duplicate case)

### `addTeammateSlotAdmin` (bypass cap, 3 cases)
- [x] Bypass: 6 non-leaders + 1 leader = 7 → 8th add succeeds
- [x] Still dedups by id
- [x] Still holds advisory lock

**Phase 3 Summary: เพิ่ม 29 tests, รวมทั้งหมด 125 tests (backend 80 + frontend 45). Typecheck ผ่าน**

---

## Phase 4 — HTTP Integration (`app.inject()`) — **Partial DONE** ✅

> Decision: ใช้ mocked Prisma + เครื่องมือมาตรฐาน (real `@fastify/secure-session` + test-only login route) — Testcontainers + Postgres จริงเก็บไว้ทำ E2E tier แยก
> Harness: `backend/src/test-utils/buildTestApp.ts` (real secure-session + `POST /__test/login` + optional multipart) + `loginAs()` helper
> Test files ทั้งหมดอยู่ใน `src/routes/*.test.ts` (path alias ไม่ resolve นอก `src/`)

### `POST /api/scans` (`routes/scans.ts`) — 11 tests ✅
- [x] No session cookie → 401 `unauthenticated`
- [x] Missing scanner_id in body → 400
- [x] scanner_id !== session.employeeId → 403 `scanner_mismatch` (processScan ไม่ถูกเรียก)
- [x] scanner_id === scanned_id → 400 `self_scan`
- [x] outcome=match → 200 + payload pass-through
- [x] outcome=mismatch → 200 + pair_id
- [x] teammate mode (no card_ref) → cardRef passed as undefined
- [x] NotFoundError → 404 `{error:'not_found', resource}`
- [x] GameEndedError → 409 `{error:'game_ended'}` (Note: route ใช้ 409 ไม่ใช่ 410 ตามที่ plan เดิมเขียน)
- [x] Unknown error bubbles → 500

### `POST /api/admin/auth/login` + logout + me (`routes/adminAuth.ts`) — 7 tests ✅
- [x] Correct creds → 200 + session.isAdmin=true (verified via /admin/auth/me)
- [x] Wrong password → 401 invalid_credentials
- [x] Wrong username (same length) → 401
- [x] Shorter username (unequal length, safeEqual handles) → 401
- [x] Longer password → 401
- [x] Logout → 204 + isAdmin cleared
- [x] /admin/auth/me anonymous → isAdmin=false
- [ ] Rate-limit 11th request → 429 *(ต้อง register @fastify/rate-limit ในทดสอบ; ข้ามไปเพราะเป็น cross-cutting plugin ที่ทดสอบดีกว่าใน real-server smoke)*

### `routes/chat.ts` — GET + POST (11 tests) ✅
**GET /chat/:pairId/question:**
- [x] No session → 401
- [x] Pair missing → 404
- [x] Pair.kind=TRIVIA → 400 not_teammate_pair
- [x] Session not hunter/target → 403 forbidden
- [x] Happy path → 200 + question + role + counterpart + myAnswered/theirAnswered flags

**POST /chat/:pairId/confirm-teammate:**
- [x] No session → 401
- [x] Pair missing → 404
- [x] Pair.kind=TRIVIA → 400
- [x] Session not hunter/target → 403
- [x] Empty/whitespace answer → 400 missing_answer
- [x] First submitter: bothAnswered=false, addTeammateSlot NOT called, no broadcast
- [x] Second submitter: bothAnswered=true → addTeammateSlot called for BOTH sides + broadcast `chat.both_answered` to other side
- [x] Cross-cohort mutual-add silently skips (year mismatch) → no addTeammateSlot

### `routes/penalty.ts` — POST + GET (10 tests) ✅
**POST /penalty/:pairId/confirm:**
- [x] No session → 401
- [x] Pair missing → 404
- [x] Session !== pair.targetId (e.g., hunter trying to confirm) → 403 not_target
- [x] No file attached → 400 missing_photo (uploadImage NOT called)
- [ ] Happy path multipart upload → 200 + broadcasts + memoryPhoto + invalidate *(skip; multipart payload construction ใน inject ค่อนข้างซับซ้อน, smoke test ที่ real DB คุ้มกว่า)*
- [ ] Wrong MIME type (not_an_image) *(เลื่อน; ต้อง multipart real upload เหมือนกัน)*

**GET /penalty/:pairId:**
- [x] No session → 401
- [x] Pair missing → 404
- [x] triviaPenalty side-row null → targetConfirmed=false, proofPhotoUrl=null, penalty=null
- [x] Full state present → returns confirmed=true + URL + penalty.id/text

### Routes ที่เลื่อนใน Phase 4 — **ส่วนใหญ่ทำใน Phase 6.2 แล้ว**
- [x] `GET /api/me` + `GET /api/me/progress` — **done in Phase 6.2** (`routes/auth.test.ts`)
- [x] `GET /api/me/pending-penalty` — **done in Phase 6.2**
- [x] `routes/admin.ts` smoke (every route 401 without isAdmin) — **done in Phase 6.2** (`routes/admin.test.ts`)
- ⏭ `GET /api/completion/ranking` — *DEFERRED to E2E tier; leader-excluded logic อยู่ใน Prisma `_count.where`, ทดสอบกับ DB จริงคุ้มกว่า. TTL ครอบใน `ttlCache.test.ts` แล้ว*

**Phase 4 Summary: เพิ่ม 39 tests (11+7+11+10), รวมทั้งหมด 164 tests (backend 119 + frontend 45). Typecheck ผ่าน**

---

## Phase 5 — Frontend Component Tests (P2) — **Partial DONE** ✅

### `frontend/src/lib/i18n/useT.test.ts` — 9 tests ✅
- [x] Existing key in `th` → return th value (e.g. `common.cancel`)
- [x] Existing key in `en` when lang=en → return en value
- [x] Missing in both → return key string itself
- [x] Variable interpolation `{name}` → substitute (en: `lang.switchTo`)
- [x] Missing variable → leave `{name}` as literal
- [x] null/undefined variable → leave placeholder
- [x] Numeric variable → coerce to string
- [x] `useT()` hook re-renders on language change
- [x] `tList(key)` returns `[]` when value is not array / missing

### `frontend/src/api/client.test.ts` — 12 tests ✅
**Happy paths:**
- [x] 200 JSON → returns parsed body
- [x] 204 No Content → returns undefined

**401 path-dependent handling (CRITICAL — admin user must not be ejected):**
- [x] 401 จาก `/me` ตอนอยู่ `/user` → clear profile + redirect to `/?expired=1`
- [x] 401 จาก `/admin/me` → NO clear, NO redirect (AdminShell handles)
- [x] 401 ตอนอยู่ `/` → clear profile แต่ไม่ redirect (avoid loop)
- [x] 401 ตอนอยู่ `/memory` → ไม่ redirect (public page)
- [x] 401 ตอนอยู่ `/admin` → ไม่ redirect
- [x] 401 ตอนอยู่ `/admin/players` → ไม่ redirect

**Error mapping:**
- [x] 403 → ApiError + toast via describeHttpError
- [x] 500 → toast
- [x] Network error → toast + rethrow
- [x] Non-JSON error body → ApiError with body=null, code=undefined

**Request shaping:**
- [x] `api.post` sends `application/json` + serialized body
- [x] `api.postForm` omits Content-Type (FormData sets boundary)

### `frontend/src/features/welcome/WelcomePage.test.tsx` — 11 tests ✅
- [x] No query → no banner
- [x] `?error=auth_failed` → renders auth-failed banner (Thai default)
- [x] `?error=not_registered` → not-registered banner
- [x] `?expired=1` → session-expired banner
- [x] Unknown error code → no banner (ignored)
- [x] Dismiss button removes banner
- [x] `lang=en` → banner switches to English copy
- [x] CTA button rendered with aria-label

### Routes ที่เลื่อนใน Phase 5 — **ScannerPage ทำใน Phase 6.5 แล้ว**
- [x] **ScannerPage** — **done in Phase 6.5** (`ScannerPage.test.tsx`, 9 tests, mock `Html5Qrcode` class)
- ⏭ `VITE_DEV_LOGIN_ENABLED=true` dev-login picker — *DEFERRED; require env override + module reload, low ROI สำหรับ dev-only feature*

**Phase 5 Summary: เพิ่ม 32 tests (frontend), รวมทั้งหมด 196 tests (backend 119 + frontend 77). Typecheck ผ่านทั้งคู่**

---

## Cross-cutting / Drift Guards — **ทำใน Phase 6.1 แล้ว**

- [x] **ScanOutcome triple-mirror** — **done in Phase 6.1**: compile-time `Equal<>` check ใน `backend/src/__drift__.test.ts` + `frontend/src/__drift__.test.ts` (canonical kind list × 2 ฝั่ง)
- [x] **SENIOR_COHORT_CUTOFF mirror** — **done in Phase 6.1**: behavioral pin ทั้ง backend (`inSameYearGroup` boundary) และ frontend (`formatYearGroup` output)
- [x] **WsEvent mirror** — **done in Phase 6.1**: shared `WsEvent` kinds เป็น subset ของ backend `PairWsEvent | UserWsEvent` (compile-time)

---

## Coverage Targets — **OUT OF SCOPE (per user instruction)**

ผู้ใช้สั่งไม่รัน coverage measurement / ไม่ตั้ง CI — targets ด้านล่างเป็น aspirational reference เท่านั้น ไม่ได้บังคับใน suite ปัจจุบัน. ถ้าจะวัดในอนาคต รัน `npm run test:coverage` (script พร้อมแล้วใน package.json ทั้ง 2 ฝั่ง)

- ⏭ `backend/src/domain/**` ≥ 80% line coverage
- ⏭ `backend/src/lib/**` ≥ 70%
- ⏭ `backend/src/routes/**` ≥ 50% (integration tier covers ส่วนนี้)
- ⏭ `frontend/src/game/**` ≥ 80%
- ⏭ `frontend/src/lib/**` ≥ 60%

---

## Gotchas เฉพาะ repo นี้ (สำคัญตอน setup)

1. **`config.ts` ใช้ Zod + `process.exit(1)`** — set env vars ครบใน `vitest.config.ts > test.env` หรือ `vi.mock('@/config.js')` ก่อน import โมดูลที่ chain ไป config
2. **`.js` extension บน import** — ใช้ Vitest + `vite-tsconfig-paths` (Jest จะปวดหัวมาก)
3. **In-memory caches** (employee/triviaCard/penalty/chatQuestions) — เรียก `invalidate*` ใน `beforeEach` ไม่งั้น test order matters
4. **Zustand persist** — `localStorage.clear()` + `useGame.setState(emptyState)` ใน `beforeEach`
5. **WS broadcasts silent no-op** ถ้าไม่มี subscriber → assert ผ่าน `vi.mocked(broadcastToUser).toHaveBeenCalledWith(...)` ตรง ๆ
6. **Time-sensitive tests** — สำหรับ gameClock ใช้ `env.GAME_NOW_OVERRIDE` (production-style); สำหรับ TTL cache ใช้ `vi.useFakeTimers()`
7. **Cloudinary upload** — mock `@/lib/cloudinary.js` คืน `{ secure_url: 'https://test/foo.jpg' }`
8. **Advisory lock SQL** — Prisma mock ต้อง stub `tx.$executeRaw` ให้ resolve

---

## Rollout Timeline (Suggested)

| สัปดาห์ | งาน | Deliverable |
|---|---|---|
| 1 | Setup + Phase 1 (pure) | ~50 tests, coverage baseline |
| 2 | Phase 2 (state) + Phase 3 part 1 (trivia branches) | match/mismatch/gameEnded green |
| 3 | Phase 3 part 2 (teammate + cap) | ครบ 9 outcomes |
| 4 | Phase 4 (HTTP integration: scans, penalty, chat) | 3 routes หลัก green |
| 5 | Phase 5 (frontend critical) + gap-fill | hit coverage targets |

---

## Phase 6 — Closing the gaps (Plan)

> Created 2026-05-11 หลังได้ external audit ที่ระบุ gap ที่ยังเหลือใน 196-tests baseline
> **Out of scope ตามคำสั่งผู้ใช้:** CI workflow (`.github/workflows/test.yml`), coverage measurement
> **In scope:** test files, source-code drift guards (ต้อง `export type` เพิ่ม), QA plan updates

### วิเคราะห์ audit + priority ranking

Audit แนะนำลำดับนี้ — ผมเห็นด้วย 3/5 และเสนอปรับ 2/5:

| # | Audit's recommendation | ผม agree? | เหตุผล |
|---|---|---|---|
| 1 | ScannerPage 9-outcome dispatch | ⚠️ Partial | "CRITICAL" จริงแต่ jsdom ครอบ html5-qrcode + camera + cooldown timing ลึกได้ยากมาก, ROI ต่อ effort ต่ำกว่าที่คิด. Strategy A (mock html5-qrcode constructor + capture decoded callback) เป็นไปได้แต่เปราะตาม library version |
| 2 | `routes/admin.ts` smoke | ✅ Agree | preHandler hook gate ทดสอบครั้งเดียวคุ้ม security boundary |
| 3 | `routes/auth.ts /me/progress` | ✅ Agree | Endpoint ที่ player ยิงทุกครั้ง |
| 4 | Drift guards | ✅ Agree, **ขยับขึ้นมา #1** | Compile-time check เขียนครั้งเดียว, effort ต่ำ, prevent ทั้ง class ของ silent drift bugs |
| 5 | CI workflow | ❌ Out of scope | ผู้ใช้สั่งไม่แตะ infra |

**ลำดับที่ผมเสนอ (re-ranked by ROI/effort):**

### 6.1 Drift Guards (P0, ~1-2 hr) — ROI สูงสุด, effort ต่ำสุด — **DONE** ✅
- [x] **ScanOutcome kind union triple-mirror** — TypeScript `Equal<>` compile-time check
  - `backend/src/__drift__.test.ts` + `frontend/src/__drift__.test.ts`
  - Added `export` to `ScanOutcome` ใน `backend/src/domain/scan.ts`
  - Canonical list (9 kinds) hardcoded ใน 2 test files — ถ้าอย่างใดอย่างหนึ่ง drift, ฝั่งที่ตรงจะ pass แต่อีกฝั่ง fail at compile time
- [x] **SENIOR_COHORT_CUTOFF mirror** — behavioral pin
  - backend: `inSameYearGroup(2022, 2023) === false`, `inSameYearGroup(2022, 2021) === true`, etc.
  - frontend: `formatYearGroup(2022) === 'pre-2023'`, `formatYearGroup(2023) === 'Class of 2023'`
- [x] **WsEvent partial mirror** — Compile-time subset check
  - Shared kinds `'penalty.update' | 'game.ended'` must be subset of `PairWsEvent | UserWsEvent` (backend hub.ts)
  - Catches drift: rename event kind ใน hub.ts โดยไม่อัพเดท shared/types.ts

### 6.2 Backend route smokes (P1, ~2-3 hr) — **DONE** ✅
- [x] **`routes/admin.ts` smoke** — 11 sampled routes × multiple session states
  - Mock `@/db/prisma.js` + every cache/lib อื่น ๆ (10+ modules) — handler ไม่ถูกเรียก เพราะ gate fire ก่อน
  - Test: no cookie → 401, employeeId but no isAdmin → 401, isAdmin=false → 401
  - Verify gate-pass case: isAdmin=true → NOT 401 (handler reached, ล้มที่ prisma mock — expected)
  - **Gotcha จดไว้:** Fastify lifecycle รัน body validation **ก่อน** preHandler. Routes ที่ schema มี required body fields (POST /admin/employees, POST /admin/trivia, PATCH /admin/employees/:id) จะตอบ 400 ก่อน gate fire — sampled เฉพาะ routes ที่ไม่มี required body schema
- [x] **`routes/auth.ts` /me + /me/progress + /me/pending-penalty**
  - /me — 401, 200 with profile, 404 not_found, email fallback to '' when null
  - /me/progress — 401, 200 full shape, gameEndedAt set when isGameEnded()=true, empty shape for new player
  - /me/pending-penalty — 401, null when no pending, role=hunter/target
  - **Skip:** Azure callback (real OIDC ไม่เหมาะ unit, smoke test ที่ staging)

### 6.3 Cache layer wrappers (P2, ~30 min, batch) — **DONE** ✅
- [x] **`lib/employeeCache.test.ts`** — 8 tests: 5 lookup-pattern + TTL refresh + in-flight dedup (5 concurrent → 1 DB call) + invalidate
- [x] Comment header ใน test file ระบุว่าเป็น representative pattern test — sibling caches (`triviaCardCache`, `penaltyCache`, `photoPlaceCache`) ใช้ pattern เดียวกัน

### 6.4 Small utility tests (P2, ~30 min, batch) — **DONE** ✅
- [x] **`lib/errorStore.ts`** (frontend) — push (default kind=error / explicit info), unique ids, dismiss (idempotent on unknown id)
- [x] **`describeHttpError`** — direct test ของ status mapping (403/404/400/409 game_ended/not_yet_ended/5xx/unmapped)

### 6.5 ScannerPage (P1 per audit, ~4-6 hr) — **DONE** ✅
- [x] **ScannerPage 9-outcome dispatch** — Strategy A: mock `Html5Qrcode` class
  - 9 tests: trivia (match + mismatch), teammate (chat + wrong_year + already_added + leader_clash + teammate_full), guard rails (self-scan + dedup)
  - **Mock pattern:** ใช้ `class MockHtml5Qrcode` (ไม่ใช่ `vi.fn().mockImplementation`) เพราะ arrow function ไม่ใช่ constructor — production code `new Html5Qrcode(...)` ต้องการ class
  - **Captured callback pattern:** mock `start()` เก็บ `onSuccess` ลง module-level ref → test invoke ตรงๆ
  - dedup test: 2 calls ติด ๆ ใน 3s window → API ถูกเรียกครั้งเดียว (ref-based throttle ใน lastScanRef ทำงาน)

### 6.6 WS reconnect hooks (P2, ~2-3 hr) — **DONE** ✅
- [x] **`lib/useUserSocket.test.ts`** — 14 tests
  - Connect lifecycle: ws opened on mount with employeeId, no connect when undefined, no connect when `document.hidden=true`
  - Open handler fetches `pendingPenalty + pendingChat` → writes results into gameStore
  - Message dispatch: `game.ended` / `pair.created` (trivia target only — hunter ignored, scanner sets locally) / `chat.both_answered` / `memory.captured`
  - Malformed JSON → no crash
  - Close → reconnect scheduled (fake timers advance 5s → 2nd socket created)
  - visibilitychange: live socket → resync state only / dead socket → fresh connect (skip backoff)
  - Cleanup on unmount → socket closed
- [x] **`lib/useWebSocket.test.ts`** (`usePairSocket`) — 7 tests
  - Connect to `/ws/pair/:pairId`, no connect when pairId undefined
  - Handler routing by frame type, unknown type no-op, malformed JSON no-op
  - send() no-op when not OPEN, send() forwards JSON when OPEN
- **Mock pattern:** `MockWebSocket` class with `fireOpen`/`fireMessage`/`fireClose` test helpers, stubbed via `vi.stubGlobal('WebSocket', MockWebSocket)`

### Out of scope (defer ไป E2E tier หรือ skip)
- `routes/memories.ts`, `missions.ts`, `photoPlaces.ts` — CRUD + multipart, ทำดีกว่าที่ E2E
- `features/admin/*`, `features/result`, `features/teammate`, `features/trivia`, `features/memoryWall`, `features/ranking`, `features/complete` — page-level component tests, value อยู่ที่ flow ครบ ๆ ไม่ใช่ unit
- `lib/compressImage.ts` — canvas-heavy ใน jsdom จำกัด, manual test ในเบราว์เซอร์เร็วกว่า
- Azure callback — OIDC integration, smoke test ที่ staging
- CI workflow + coverage runs — **out of scope per user**

### Stop criteria — เมื่อไหร่ถือว่า "พอ"
หลัง 6.1 + 6.2 + 6.4 เสร็จ (~3-5 hr):
- Drift guards เซต safety net ระยะยาว
- routes ที่ player + admin ใช้ตอนเปิดเกมครอบหมด
- Small utilities ครอบ
- เหลือ ScannerPage / WS hooks / cache wrappers เป็น "ทำได้ถ้ามีเวลา"

หลัง 6.1-6.6 เสร็จ (~10-13 hr): suite อยู่ในสภาพ "production-ready unit coverage". เกินกว่านี้คือ component-level + E2E tier ที่คุ้มทำเป็น separate effort

### Effort breakdown — **ALL DONE** ✅
| Section | Effort | Tests จริง | Cumulative | Status |
|---|---|---|---|---|
| 6.1 Drift guards | 1-2 hr | 5 | 201 | ✅ |
| 6.2 Backend routes | 2-3 hr | 35 | 236 | ✅ |
| 6.3 Cache wrapper | 30 min | 8 | 244 | ✅ |
| 6.4 Small utilities | 30 min | 13 | 257 | ✅ |
| 6.5 ScannerPage | 4-6 hr | 9 | 266 | ✅ |
| 6.6 WS hooks | 2-3 hr | 21 | ~287 | ✅ |

**Final total: 285 tests (backend 162 / frontend 123) — Phase 6 ครบ**

---

## Final Audit (2026-05-11) — สถานะรวมของ QA suite

**Test count: 285 ผ่านหมด** (backend 162 / 15 files, frontend 123 / 10 files) — typecheck clean ทั้ง 2 ฝั่ง

### ✅ ทำครบแล้ว
| ส่วน | Tests | สถานะ |
|---|---|---|
| Setup + Vitest config (backend + frontend) | — | ✅ |
| Phase 1 — Pure functions | 53 | ✅ |
| Phase 2 — Logic with state | +43 | ✅ |
| Phase 3 — `processScan` 9-branch matrix | +29 | ✅ |
| Phase 4 — HTTP integration (scans, adminAuth, chat, penalty) | +39 | ✅ partial (multipart happy path skipped) |
| Phase 5 — Frontend critical (i18n, api/client, WelcomePage) | +32 | ✅ partial |
| Phase 6.1 — Drift guards (ScanOutcome + WsEvent + cohort cutoff) | +5 | ✅ |
| Phase 6.2 — admin smoke + auth /me + /me/progress + /me/pending-penalty | +35 | ✅ |
| Phase 6.3 — Cache wrapper representative test | +8 | ✅ |
| Phase 6.4 — errorStore + describeHttpError | +13 | ✅ |
| Phase 6.5 — ScannerPage 9-outcome dispatch | +9 | ✅ |
| Phase 6.6 — useUserSocket + usePairSocket | +21 | ✅ |

### ⏭ Skipped (มีเหตุผลชัดเจน, จด rationale ไว้แล้ว)
- **prisma-mock fixture** — ใช้ manual mock ใน Phase 3 แทน, เพียงพอ
- **Persist version 7 migration test** — Zustand persist ไม่มี migrate callback ในโค้ดปัจจุบัน
- **Rate-limit 429** — cross-cutting plugin, smoke test ที่ real server คุ้มกว่า
- **Multipart photo upload happy path (penalty)** — payload construction ใน `inject` ซับซ้อน, E2E คุ้มกว่า
- **`completion/ranking` route** — logic หลักอยู่ใน Prisma `_count.where`, E2E + real DB คุ้มกว่า
- **`VITE_DEV_LOGIN_ENABLED` dev-login picker** — dev-only feature, low ROI
- **Azure SSO callback** — OIDC integration, smoke ที่ staging
- **ScannerPage `cooldown re-arm` test** — fake-timer + Cooldown component, behavior ครอบโดย dedup test แล้ว

### ⏭ Out of scope (per user instruction)
- **CI workflow** (`.github/workflows/test.yml`)
- **Pre-commit hook**
- **Coverage measurement** runs + threshold enforcement *(script `npm run test:coverage` ใช้งานได้แต่ไม่บังคับ)*

### 🔚 Routes/features ที่ defer ไป E2E tier
| ส่วน | เหตุผล |
|---|---|
| `routes/memories.ts`, `missions.ts`, `photoPlaces.ts` | CRUD + multipart, E2E ดีกว่า |
| `features/admin/*` (pages) | Page-level state machine, flow test คุ้มกว่า |
| `features/result`, `teammate`, `trivia`, `memoryWall`, `ranking`, `complete` | Page-level UI, manual + device smoke ในสนาม |
| `lib/compressImage.ts` | Canvas-heavy ใน jsdom จำกัด |

### สรุป
แผนใน `QA_PLAN.md` ครอบครบทุกข้อที่เคยตั้งไว้ — checkbox ทุกอันมีสถานะชัดเจน 3 แบบ: ✅ done, ⏭ skipped (with rationale), หรือ defer ไป E2E. ไม่มี checkbox ที่ลืมหรือค้างโดยไม่มีเหตุผล

---

## Log / Notes

(ใช้ section นี้บันทึก issue ที่เจอตอนเขียน test — flaky tests, mocking ที่ยากกว่าคาด, design decisions ฯลฯ)

- 2026-05-11: แผนนี้ถูกสร้างขึ้น ยังไม่เริ่มเขียน test
- 2026-05-11: **Phase 6 Sprint 2 เสร็จ — Phase 6 ครบทุก section** — เพิ่ม 39 tests (cache wrapper + ScannerPage + WS hooks) → รวม **285 tests** (backend 162 + frontend 123)
  - **ScannerPage mock gotcha:** `Html5Qrcode` ต้อง mock ด้วย `class` ไม่ใช่ `vi.fn().mockImplementation(() => ...)` — arrow function ไม่ใช่ constructor, production code ใช้ `new Html5Qrcode(...)`
  - **Captured callback pattern:** mock `start(camera, config, onSuccess)` เก็บ `onSuccess` ใน hoisted ref → test invoke ตรง ๆ ผ่าน captured.onDecoded เพื่อ exercise dispatch logic โดยไม่ต้องเปิด camera
  - **WS mock:** `MockWebSocket` class กับ static `OPEN`/`CLOSED` + `fireOpen`/`fireMessage`/`fireClose` test helpers, stub ผ่าน `vi.stubGlobal('WebSocket', MockWebSocket)` — production code reads global `WebSocket.OPEN` ก็ทำงานเพราะ static
  - **Visibility test:** `document.hidden` ใช้ `Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })` แทนการ assign ตรง ๆ (jsdom เป็น getter-only)
  - **Cache wrapper test:** ยืนยัน TTL + in-flight dedup pattern เดียวกับ chatQuestions — sibling caches ทุกตัวใช้ template เดียวกัน ไม่ต้องเทสต์แยก
- 2026-05-11: **Phase 6 Sprint 1 เสร็จ** — drift guards + admin gate smoke + auth /me routes + errorStore = เพิ่ม 50 tests → รวม **246 tests** (backend 154 + frontend 92)
  - **Source code change ที่จำเป็น:** `export` keyword หน้า `type ScanOutcome` ใน `backend/src/domain/scan.ts` — ทำให้ drift guard compile-time check ทำงาน
  - **Fastify lifecycle gotcha:** body schema validation รันก่อน preHandler hook → POST/PATCH ที่ schema มี `required: [...]` จะตอบ 400 ก่อน gate fire ทำให้ admin smoke ต้อง sample เฉพาะ routes ที่ไม่มี required body (หรือต้องส่ง valid body ครบ)
  - **Drift guard design choice:** ไม่ import จาก `shared/types.ts` cross-package (rootDir constraint) — ใช้ canonical kind list hardcode ใน 2 test files แทน, อาศัย `Equal<>` type-level check
  - **Admin gate pass-through verify:** เทสต์ "gate ผ่านเมื่อ isAdmin=true" ตรวจ statusCode `!== 401` (รับ 500 จาก prisma mock ที่ไม่ได้ stub queries) — point คือ pre-handler ปล่อยผ่าน
- 2026-05-11: **Phase 5 (partial) เสร็จ** — frontend i18n + api/client + WelcomePage banner = เพิ่ม 32 tests → รวม **196 tests** (backend 119 + frontend 77)
  - `api/client.test.ts` mock `window.location` ผ่าน `Object.defineProperty(window, 'location', { value: { pathname, assign: vi.fn(), href } })` — jsdom default assign ไม่ใช่ spy
  - Skip ScannerPage — html5-qrcode + camera APIs ยุ่ง, ROI ต่ำกว่า device test ในสนาม
  - `WelcomePage` ใช้ `MemoryRouter initialEntries={['/?error=auth_failed']}` แทนการ mock react-router-dom ตรง ๆ — ได้ทั้ง useSearchParams + useNavigate ในคราวเดียว
  - Asset PNG imports ใน WelcomePage mock เป็น string ผ่าน `vi.mock('../../assets/asset01.png', () => ({ default: 'asset01.png' }))` — Vite resolve URL ใน build, vitest opaque
  - Locale assertion ใช้ `screen.getByRole('alert').toHaveTextContent(th.welcome.authFailed)` — import locale dict โดยตรง ไม่ hard-code Thai string ในเทสต์
- 2026-05-11: **Phase 4 (partial) เสร็จ** — HTTP integration 4 routes สำคัญ: scans, adminAuth, chat, penalty (read paths) เพิ่ม 39 tests → รวม **164 tests**
  - `tests/` ไม่ได้ alias `@/*` เพราะ tsconfig include เป็น `["src"]` เท่านั้น — ย้าย test files เข้า `src/routes/*.test.ts` และ helper ไปที่ `src/test-utils/buildTestApp.ts`
  - Harness: real `@fastify/secure-session` (32-byte deterministic key 0x01) + test-only `POST /__test/login` writes employeeId/isAdmin → `loginAs(app, {...})` returns ready-made `Cookie` header
  - chat.ts ใช้ `vi.importActual` keep `toEmployeeShape` + `inSameYearGroup` real, stub แค่ `addTeammateSlot` — scan.js โหลด prisma ต้องถูก mock ก่อน (mock prisma.js ก่อน mock scan.js)
  - penalty multipart happy path: ข้ามไปก่อน (multipart payload construction ใน `inject` ต้องใช้ form-data lib หรือ FormData boundary handling), 400 missing_photo cover edge cases หลักได้แล้ว — full upload flow คุ้มกว่าที่ E2E
  - Skip: rate-limit (cross-cutting plugin), admin.ts gate smoke (prisma mock เยอะ), me/progress + me/pending-penalty (query-only), completion/ranking (logic อยู่ใน Prisma query)
- 2026-05-11: **Phase 3 เสร็จ** — เพิ่ม 29 tests (`scan.processScan.test.ts`) ครอบ 9 outcomes + addTeammateSlot cap + addTeammateSlotAdmin override = backend 80 / frontend 45 / รวม **125 tests**
  - ไม่ติดตั้ง `vitest-mock-extended` — manual mock ของ Prisma surface ที่ใช้จริงพอ, type เป็น `any` ใน hoisted scope
  - `$transaction` mock callback รับ prismaMock เป็น `tx` parameter → covers ทั้ง bare และ transactional calls โดย mock surface เดียว
  - `mockResolvedValueOnce` ระวัง: ถ้า test path เรียก method ซ้ำ จะกลับไป default ที่ undefined (พบใน addTeammateSlot loop) — ใช้ `mockResolvedValue` แทน
  - Same-round re-scan broadcast assertion ⚠️ เป็น "load-bearing test" — ถ้าใครเอา `if (newRound)` ไป gate broadcast แทน, test ตัวนี้จะดับทันที (กันการ regress)
  - Typecheck ต้อง: 1) Prisma mock เป็น `any` (Record<string,unknown> จะทำให้ `.teammateSlot` กลายเป็น unknown), 2) Emp fixture ต้องมี `initial` field เพราะ `EmployeeShape` ใน scan.ts บังคับ
- 2026-05-11: **Phase 2 เสร็จ** — เพิ่ม 43 tests (backend +24, frontend +19) รวมทั้งหมด 96 tests
  - Pattern สำหรับ test cache state: `vi.resetModules() + dynamic import` ใน beforeEach (ttlCache, chatQuestions)
  - chatQuestions ใช้ `vi.hoisted` mock prisma — รองรับ per-test override ของ findMany โดยไม่ต้องสร้าง module ใหม่ตลอด
  - `requireAdmin` ต้องผ่าน **strict boolean true** เท่านั้น — เทสต์เคส string `"true"` ก็ถูก block ตามเจตนา
  - Skip "persist version 7 migration test" — Zustand persist ไม่ได้ตั้ง migrate callback ในโค้ดปัจจุบัน ทำให้ runtime behavior ก็แค่ ignore เวอร์ชันที่ไม่ตรง (ลบ key) ซึ่งไม่ได้เป็น code path ที่เปราะ
- 2026-05-11: **Phase 1 เสร็จ** — Vitest setup ทั้ง 2 ฝั่ง, 53 tests ผ่าน (backend 27 + frontend 26)
  - Backend env vars baseline อยู่ใน `vitest.config.ts > test.env` — เพียงพอให้ import chain ผ่าน Zod
  - `gameClock.test.ts` ใช้ pattern `vi.resetModules() + vi.doMock('@/config.js') + dynamic import` เพราะ `env` ใน config.ts captured ตอน module-load — set per-test ตรง ๆ ไม่ได้
  - `scan.helpers.test.ts` ต้อง mock prisma/cache/hub/gameClock เพื่อ import scan.ts ผ่าน แม้จะใช้แค่ pure helpers
  - Frontend `npm test` ใช้เวลานาน (68s) เพราะ jsdom environment setup บน Windows ช้า — test เองรัน 297ms เท่านั้น
  - Vite เตือนเรื่อง `vite-tsconfig-paths` deprecated (Vite รองรับ native แล้ว) — ยังใช้ได้, ค่อย migrate ตอน Phase ถัด ๆ ไป
