# Seed CSVs

`scripts/seed.ts` ต้องการไฟล์ CSV 3 ไฟล์ที่ **ไม่ถูก commit ลง repo** เพราะมีข้อมูลพนักงานจริง (PII) — ห้าม push ขึ้น GitHub ทุกกรณี

`backend/.gitignore` ตั้ง `scripts/*.csv` ไว้ block ไว้แล้ว ถ้าเห็น `git status` ขึ้น `?? scripts/<ชื่อไฟล์>.csv` แสดงว่า ignore ทำงานถูก — อย่าฝืน `git add -f`

## วิธีรับไฟล์

ดาวน์โหลด 3 ไฟล์ด้านล่างจากลิงก์ที่ทีม Internship/PM แจกให้ในช่อง private (Slack / Google Drive / Notion):

> 🔗 **Download URL:** `<วาง URL ที่ได้รับจากทีมตรงนี้ — อย่า commit ลง repo>`

แล้ววางไว้ที่ `backend/scripts/` (โฟลเดอร์เดียวกับ `seed.ts`):

```
backend/scripts/
├── seed.ts
├── wipe.ts
├── README.md                       ← (ไฟล์นี้)
├── Employee Data.csv               ← ดาวน์โหลด
├── Teamlead.csv                    ← ดาวน์โหลด
└── TriviaQuestion AndTarget.csv    ← ดาวน์โหลด
```

ถ้าทีมยังไม่ได้แจกลิงก์ → ติดต่อ PM/หัวหน้าทีม internship

## ไฟล์ที่ต้องการ

| ไฟล์ | คอลัมน์สำคัญที่ `seed.ts` อ่าน | หมายเหตุ |
|---|---|---|
| `Employee Data.csv` | `ID`, `Status`, `Name (EN)`, `Surname (EN)`, `Nickname (EN)`, `Company Email`, `Division`, `Position`, `Employment Date` (`DD/MM/YYYY`), `Date of Birth` (`DD/MM/YYYY`) | row ที่ `Status = "Waiting Start Work"` ถูก skip; ถ้าไม่มี `Company Email` → username = `id` lowercase |
| `Teamlead.csv` | `ID`, `คำใบ้` (optional) | ID ที่อยู่ในไฟล์นี้จะถูก flag `isLeader = true` พร้อมเก็บคำใบ้ |
| `TriviaQuestion AndTarget.csv` | คอลัมน์ที่ 1 = index ตัวเลข, คอลัมน์ที่ 2 = clue text (รองรับ multi-line: row ถัดไปที่คอลัมน์ 1 ว่างจะถูก append เป็น clue ต่อ จนกว่าจะเจอ blank row คั่น) | column target IDs (3+) **ปัจจุบัน seed ยังไม่อ่าน** — ทุก card connect แค่ user `TEST-AWARDS` เป็น target |

## รัน seed

หลังวางไฟล์เสร็จ:

```bash
cd backend
npm run seed
```

ถ้า CSV หายจะได้ error `ENOENT: no such file or directory, open '...Employee Data.csv'`

## ⚠️ ถ้าเผลอ commit CSV ขึ้น GitHub แล้ว

`git rm --cached` อย่างเดียวไม่พอ — ไฟล์ยังอยู่ใน git history. ต้อง rewrite history (`git filter-repo` หรือ BFG Repo-Cleaner) แล้ว force-push, **และต้องแจ้งทีมให้ rotate / ตรวจสอบ PII ที่หลุด** ทันที. ถ้าเป็น public repo ให้ถือว่าข้อมูลรั่วไปแล้วและรายงานตามขั้นตอน privacy ของบริษัท
