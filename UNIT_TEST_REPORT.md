# Unit Testing Report

## สรุปรวม
- **285 tests ผ่านหมด** (backend 162 / frontend 123)
- Stack: **Vitest** + Testing Library + jsdom
- Run: `npm test` (ทั้ง backend และ frontend)

---

## Backend (162 tests · 15 files)

### Domain (logic เกม)
| ไฟล์ | เทสอะไร |
|---|---|
| `domain/pairId.test.ts` | TRIVIA pair สมมาตร / TEAMMATE pair directional / day-bucket / UTC midnight boundary |
| `domain/scan.helpers.test.ts` | `inSameYearGroup` (cohort cutoff 2023), `toEmployeeShape` |
| `domain/scan.processScan.test.ts` | **9-branch matrix** ของ scan: match, mismatch (new/prior/flipped/re-scan), wrong_year, wrong_leader, leader_clash, already_added, leader_full, teammate_full, chat + `addTeammateSlot` cap + admin override |
| `domain/chatQuestions.test.ts` | คำถามแชท deterministic ตาม pairId, distribution, TTL cache, in-flight dedup |

### Lib (utility / cache)
| ไฟล์ | เทสอะไร |
|---|---|
| `lib/gameClock.test.ts` | `gameNow` / `gameEndAt` / BKK +07:00 boundary / `isGameEnded` |
| `lib/ttlCache.test.ts` | TTL expiry, invalidate, stampede prevention, loader error recovery |
| `lib/employeeCache.test.ts` | representative test ของ cache wrapper (TTL + dedup + invalidate) |

### Middleware
| ไฟล์ | เทสอะไร |
|---|---|
| `middleware/auth.test.ts` | `requireSession` 401, `requireAdmin` strict boolean check |

### Routes (HTTP integration ผ่าน `app.inject`)
| ไฟล์ | เทสอะไร |
|---|---|
| `routes/auth.test.ts` | `/me` / `/me/progress` / `/me/pending-penalty` ครอบทุก status |
| `routes/adminAuth.test.ts` | login / logout / me + safeEqual edge cases |
| `routes/admin.test.ts` | smoke gate ของทุก admin route — bounce 401 เมื่อไม่ใช่ admin |
| `routes/scans.test.ts` | self-scan, scanner_mismatch, NotFound, GameEnded, outcome pass-through |
| `routes/chat.test.ts` | GET question + POST confirm (1st vs 2nd submitter, both-answered broadcast) |
| `routes/penalty.test.ts` | POST confirm (no session / no file / not_target) + GET state |

### Drift guard
| ไฟล์ | เทสอะไร |
|---|---|
| `__drift__.test.ts` | Compile-time check ScanOutcome 9 kinds + WsEvent subset + cohort cutoff |

---

## Frontend (123 tests · 10 files)

### Game state
| ไฟล์ | เทสอะไร |
|---|---|
| `game/gameStore.test.ts` | Selectors (isComplete, currentTrivia, lastSlot, gameEnded) + Actions (addTeammateSlot dedup/cap, addLeaderSlot, hydrateProgress, addTriviaStamp, setGameEnded) + `formatYearGroup` |

### Lib
| ไฟล์ | เทสอะไร |
|---|---|
| `lib/routes.test.ts` | Path builders (`triviaScan`, `fail`, `chatConfirm`, `success` URL-encode) |
| `lib/i18n/useT.test.ts` | th/en fallback, variable interpolation, `tList`, hook re-render |
| `lib/errorStore.test.ts` | push/dismiss toast, `describeHttpError` status mapping |
| `lib/useUserSocket.test.ts` | Connect lifecycle, message dispatch (game.ended / pair.created / chat.both_answered / memory.captured), reconnect, visibility |
| `lib/useWebSocket.test.ts` | `usePairSocket` connect / handler routing / send() |

### API
| ไฟล์ | เทสอะไร |
|---|---|
| `api/client.test.ts` | 200/204, **path-dependent 401** (admin ไม่โดน eject), error mapping, request shaping |

### Pages
| ไฟล์ | เทสอะไร |
|---|---|
| `features/welcome/WelcomePage.test.tsx` | Banner ตาม `?error=` / `?expired=1`, language toggle, dismiss |
| `features/scanner/ScannerPage.test.tsx` | 9-outcome dispatch ผ่าน mock `Html5Qrcode` class, self-scan, dedup throttle |

### Drift guard
| ไฟล์ | เทสอะไร |
|---|---|
| `__drift__.test.ts` | ScanOutcome 9 kinds + WsEvent subset (frontend ฝั่ง) |

---

## ส่วนที่ไม่ได้เทสต์ (มีเหตุผล)

| ส่วน | เหตุผล |
|---|---|
| `routes/memories`, `missions`, `photoPlaces` | CRUD + multipart, เหมาะ E2E |
| `routes/completion/ranking` | Logic อยู่ใน Prisma `_count.where`, ใช้ DB จริงคุ้มกว่า |
| Multipart photo upload happy path | `app.inject` multipart payload ซับซ้อน, E2E คุ้มกว่า |
| Azure SSO callback | OIDC integration, smoke ที่ staging |
| Admin pages, result/teammate/trivia/memoryWall pages | Page-level state, flow test คุ้มกว่า unit |
| `lib/compressImage` | Canvas-heavy ใน jsdom จำกัด |
| Rate-limit 429 | Cross-cutting plugin, smoke ที่ real server |
| CI workflow + coverage runs | Out of scope (per user instruction) |

รายละเอียดเต็มและ rationale ของแต่ละ skip ดูใน `QA_PLAN.md`
