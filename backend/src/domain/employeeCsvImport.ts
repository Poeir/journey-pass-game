// Admin "Import employees from CSV" — parse a CSV uploaded by the admin
// and upsert into the Employee table. Similar to `syncEmployees` but the
// source is a CSV file instead of the empeo HR API.
//
// Admin-managed fields (isLeader, leaderClue) ARE writable here — unlike
// the empeo sync, the admin is the one supplying the CSV row-by-row so
// they get to set leader flags too. Columns not present in the CSV are
// left untouched on update (we only update fields that the row actually
// provides).

import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { invalidateEmployeeCache } from '@/lib/employeeCache.js';

const HEADER_SYNONYMS: Record<keyof CsvRow, string[]> = {
  id: ['id', 'employee id', 'employeeid', 'รหัส', 'รหัสพนักงาน'],
  name: ['name', 'fullname', 'full name', 'ชื่อ', 'ชื่อ-นามสกุล', 'ชื่อนามสกุล'],
  nickname: ['nickname', 'nick', 'ชื่อเล่น'],
  position: ['position', 'title', 'ตำแหน่ง'],
  email: ['email', 'company email', 'อีเมล', 'อีเมล์'],
  dept: ['dept', 'department', 'division', 'แผนก'],
  year: ['year', 'startyear', 'start year', 'ปี', 'ปีที่เข้าทำงาน', 'employment date', 'hire date'],
  isLeader: ['isleader', 'is leader', 'leader', 'หัวหน้า', 'เป็นหัวหน้า'],
  leaderClue: ['leaderclue', 'leader clue', 'clue', 'คำใบ้', 'คำใบ้หัวหน้า'],
  photoUrl: ['photourl', 'photo url', 'photo', 'image', 'รูป', 'รูปโปรไฟล์'],
};

interface CsvRow {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  email: string | null;
  dept: string;
  year: number;
  isLeader: boolean | null;
  leaderClue: string | null;
  photoUrl: string | null;
}

type WritableField = Exclude<keyof CsvRow, 'id'>;
const COMPARABLE_FIELDS: WritableField[] = [
  'name', 'nickname', 'position', 'email', 'dept', 'year', 'isLeader', 'leaderClue', 'photoUrl',
];

export interface CsvImportResult {
  added: Array<{ id: string; name: string }>;
  updated: Array<{ id: string; name: string; changedFields: WritableField[] }>;
  errors: Array<{ id?: string; row?: number; reason: string }>;
  skipped: number;
  total: number;
  fetchedAt: string;
}

// Minimal RFC4180-ish CSV parser. Handles quoted fields with escaped quotes
// ("") and stripped CR. Copied from scripts/seed.ts so the route doesn't
// have to import a script.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(header: string[], key: keyof CsvRow): number {
  const wants = HEADER_SYNONYMS[key].map((s) => s.toLowerCase());
  return header.findIndex((h) => wants.includes(normalizeHeader(h)));
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['true', '1', 'yes', 'y', 'หัวหน้า', 'ใช่', '✓', 'x'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'ไม่ใช่', 'ลูกทีม', ''].includes(v)) return false;
  return null;
}

// Accepts 4-digit Christian year, 4-digit Buddhist year (auto-converted),
// or DD/MM/YYYY (Christian or Buddhist year in last segment).
function parseYear(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const slashMatch = v.match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
  const yearStr = slashMatch ? slashMatch[1] : (v.match(/^\d{4}$/) ? v : null);
  if (!yearStr) return null;
  let n = parseInt(yearStr, 10);
  if (!Number.isFinite(n)) return null;
  if (n > 2400) n -= 543; // Buddhist Era → Christian Era
  if (n < 1900 || n > 2100) return null;
  return n;
}

interface ColIndex {
  id: number;
  name: number;
  nickname: number;
  position: number;
  email: number;
  dept: number;
  year: number;
  isLeader: number;
  leaderClue: number;
  photoUrl: number;
}

function buildColIndex(header: string[]): { idx: ColIndex; missing: string[] } {
  const idx: ColIndex = {
    id: findColumn(header, 'id'),
    name: findColumn(header, 'name'),
    nickname: findColumn(header, 'nickname'),
    position: findColumn(header, 'position'),
    email: findColumn(header, 'email'),
    dept: findColumn(header, 'dept'),
    year: findColumn(header, 'year'),
    isLeader: findColumn(header, 'isLeader'),
    leaderClue: findColumn(header, 'leaderClue'),
    photoUrl: findColumn(header, 'photoUrl'),
  };
  const missing: string[] = [];
  if (idx.id < 0) missing.push('id');
  if (idx.name < 0) missing.push('name');
  if (idx.dept < 0) missing.push('dept');
  if (idx.year < 0) missing.push('year');
  return { idx, missing };
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export async function importEmployeesFromCsv(text: string): Promise<CsvImportResult> {
  const grid = parseCsv(text);
  if (grid.length < 2) {
    throw new CsvParseError('csv_empty_or_header_only');
  }

  const header = grid[0]!;
  const { idx, missing } = buildColIndex(header);
  if (missing.length) {
    throw new CsvParseError(`csv_missing_columns: ${missing.join(', ')}`);
  }

  const dataRows = grid.slice(1);
  const mapped: CsvRow[] = [];
  const errors: CsvImportResult['errors'] = [];
  let skipped = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]!;
    const rowNum = i + 2; // 1-based; header is line 1
    const cell = (n: number) => (n >= 0 ? (row[n] ?? '').trim() : '');

    const id = cell(idx.id);
    if (!id) { skipped++; continue; }

    const name = cell(idx.name);
    if (!name) {
      errors.push({ id, row: rowNum, reason: 'missing_name' });
      continue;
    }

    const dept = cell(idx.dept);
    if (!dept) {
      errors.push({ id, row: rowNum, reason: 'missing_dept' });
      continue;
    }

    const year = parseYear(cell(idx.year));
    if (year == null) {
      errors.push({ id, row: rowNum, reason: 'invalid_year' });
      continue;
    }

    const isLeader = idx.isLeader >= 0 ? parseBool(cell(idx.isLeader)) : null;

    mapped.push({
      id,
      name,
      nickname: cell(idx.nickname) || null,
      position: cell(idx.position) || null,
      email: cell(idx.email).toLowerCase() || null,
      dept,
      year,
      isLeader,
      leaderClue: cell(idx.leaderClue) || null,
      photoUrl: cell(idx.photoUrl) || null,
    });
  }

  // Dedup within the CSV — last occurrence wins, earlier ones reported.
  const dedup = new Map<string, CsvRow>();
  for (const m of mapped) {
    if (dedup.has(m.id)) {
      errors.push({ id: m.id, reason: 'duplicate_row_in_csv' });
    }
    dedup.set(m.id, m);
  }
  const finalRows = [...dedup.values()];

  const existing = await prisma.employee.findMany({
    where: { id: { in: finalRows.map((r) => r.id) } },
    select: {
      id: true,
      name: true,
      nickname: true,
      position: true,
      email: true,
      dept: true,
      year: true,
      isLeader: true,
      leaderClue: true,
      photoUrl: true,
    },
  });
  const existingById = new Map(existing.map((e) => [e.id, e]));

  const toCreate: CsvRow[] = [];
  const toUpdate: Array<{ row: CsvRow; changedFields: WritableField[] }> = [];

  for (const m of finalRows) {
    const prev = existingById.get(m.id);
    if (!prev) {
      toCreate.push(m);
      continue;
    }
    const changed: WritableField[] = [];
    for (const f of COMPARABLE_FIELDS) {
      // For optional CSV columns left blank, leave the existing value alone
      // (treat null as "not provided" rather than "clear to null"). Required
      // fields (name/dept/year) can't be null here.
      const nextVal = m[f];
      if (nextVal == null && (f === 'nickname' || f === 'position' || f === 'email' || f === 'isLeader' || f === 'leaderClue' || f === 'photoUrl')) continue;
      if (prev[f] !== nextVal) changed.push(f);
    }
    if (changed.length) toUpdate.push({ row: m, changedFields: changed });
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-csv-import'))`;

    for (const m of toCreate) {
      try {
        await tx.employee.create({
          data: {
            id: m.id,
            name: m.name,
            nickname: m.nickname,
            position: m.position,
            email: m.email,
            dept: m.dept,
            year: m.year,
            isLeader: m.isLeader ?? false,
            leaderClue: m.leaderClue,
            photoUrl: m.photoUrl,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          errors.push({ id: m.id, reason: `duplicate_unique (${err.meta?.target ?? 'unknown'})` });
        } else {
          errors.push({ id: m.id, reason: String(err) });
        }
      }
    }

    for (const { row: m } of toUpdate) {
      const data: Prisma.EmployeeUpdateInput = {
        name: m.name,
        dept: m.dept,
        year: m.year,
      };
      // Optional fields: only write when the CSV provided a value. Blank
      // cells leave the existing DB value untouched.
      if (m.nickname != null) data.nickname = m.nickname;
      if (m.position != null) data.position = m.position;
      if (m.email != null) data.email = m.email;
      if (m.isLeader != null) data.isLeader = m.isLeader;
      if (m.leaderClue != null) data.leaderClue = m.leaderClue;
      if (m.photoUrl != null) data.photoUrl = m.photoUrl;

      try {
        await tx.employee.update({ where: { id: m.id }, data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          errors.push({ id: m.id, reason: `duplicate_unique (${err.meta?.target ?? 'unknown'})` });
        } else {
          errors.push({ id: m.id, reason: String(err) });
        }
      }
    }
  });

  invalidateEmployeeCache();

  return {
    added: toCreate.map((m) => ({ id: m.id, name: m.name })),
    updated: toUpdate.map(({ row, changedFields }) => ({
      id: row.id,
      name: row.name,
      changedFields,
    })),
    errors,
    skipped,
    total: dataRows.length,
    fetchedAt: new Date().toISOString(),
  };
}
