import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Gate creation of the TEST-AWARDS QA fixture user. Default is off — set
// SEED_CREATE_TEST_USER=true in backend/.env to enable. When enabled, the
// fixture employee is upserted AND wired as a target on every TriviaCard
// so scanning it with any card always yields `match`.
const CREATE_TEST_USER = process.env.SEED_CREATE_TEST_USER === 'true';

const CSV_FILENAME = 'Employee Data.csv';
const TEAMLEAD_FILENAME = 'Teamlead.csv';
const TRIVIA_FILENAME = 'TriviaQuestion AndTarget.csv';

const TEST_AWARDS_USER = {
  id: 'TEST-AWARDS',
  name: 'Test Awards User',
  nickname: 'Test',
  position: 'QA Tester',
  email: 'testawards@example.test',
  dept: 'QA',
  year: 2015,
  isLeader: false,
  leaderClue: null,
};

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

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(here, CSV_FILENAME);
const TEAMLEAD_PATH = path.join(here, TEAMLEAD_FILENAME);
const TRIVIA_PATH = path.join(here, TRIVIA_FILENAME);

type TriviaDraft = { id: string; clue: string; targetIds: string[] };

// CSV layout (one row per card):
//   col 0 = index (1..N), col 1 = clue/question text, col 2..end = target Employee IDs.
// Empty cells between/after target IDs (trailing commas, gaps) are ignored.
// Duplicate target IDs within a row are deduped.
async function loadTriviaCards(): Promise<TriviaDraft[]> {
  const raw = await readFile(TRIVIA_PATH, 'utf-8');
  const grid = parseCsv(raw);
  if (grid.length < 2) return [];

  const cards: TriviaDraft[] = [];

  for (const row of grid.slice(1)) {
    const cells = row.map((c) => (c ?? '').trim());
    const idxStr = cells[0] ?? '';
    const idxNum = idxStr ? Number(idxStr) : NaN;
    if (!Number.isInteger(idxNum) || String(idxNum) !== idxStr) continue;

    const clue = cells[1] ?? '';
    const targetIds = Array.from(
      new Set(cells.slice(2).filter((c) => c !== '')),
    );

    cards.push({
      id: `CARD-${String(idxNum).padStart(2, '0')}`,
      clue,
      targetIds,
    });
  }

  return cards;
}

async function loadLeaders(): Promise<Map<string, string | null>> {
  const raw = await readFile(TEAMLEAD_PATH, 'utf-8');
  const grid = parseCsv(raw);
  if (grid.length < 2) return new Map();
  const header = grid[0]!.map((h) => h.trim());
  const idCol = header.indexOf('ID');
  const clueCol = header.findIndex((h) => h === 'Clues' || h === 'Clue' || h === 'คำใบ้');
  if (idCol < 0) throw new Error(`Teamlead CSV missing ID column`);
  const map = new Map<string, string | null>();
  for (const r of grid.slice(1)) {
    const id = (r[idCol] ?? '').trim();
    if (!id) continue;
    const clue = clueCol >= 0 ? (r[clueCol] ?? '').trim() || null : null;
    map.set(id, clue);
  }
  return map;
}

async function main() {
  const leaders = await loadLeaders();
  const raw = await readFile(CSV_PATH, 'utf-8');
  const grid = parseCsv(raw);
  if (grid.length < 2) throw new Error(`No data rows in ${CSV_FILENAME}`);

  const header = grid[0]!;
  const dataRows = grid.slice(1);
  const colIndex = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV missing column: ${name}`);
    return i;
  };
  const ID = colIndex('ID');
  const NAME_EN = colIndex('Name (EN)');
  const SURNAME_EN = colIndex('Surname (EN)');
  const NICK_EN = colIndex('Nickname (EN)');
  const EMAIL = colIndex('Company Email');
  const DIVISION = colIndex('Division');
  const POSITION = colIndex('Position');
  const EMP_DATE = colIndex('Employment Date');

  let imported = 0;
  let skipped = 0;

  for (const r of dataRows) {
    const id = (r[ID] ?? '').trim();
    if (!id) { skipped++; continue; }

    const nameEn = (r[NAME_EN] ?? '').trim();
    const surnameEn = (r[SURNAME_EN] ?? '').trim();
    const fullName = [nameEn, surnameEn].filter(Boolean).join(' ') || id;
    const nickname = (r[NICK_EN] ?? '').trim() || null;

    const email = (r[EMAIL] ?? '').trim().toLowerCase() || null;

    const dept = (r[DIVISION] ?? '').trim();
    const position = (r[POSITION] ?? '').trim() || null;

    const empDateParts = (r[EMP_DATE] ?? '').trim().split('/');
    const year = empDateParts.length === 3 ? parseInt(empDateParts[2]!, 10) || 0 : 0;

    const isLeader = leaders.has(id);
    const leaderClue = isLeader ? leaders.get(id) ?? null : null;

    const employee = {
      id,
      name: fullName,
      nickname,
      position,
      email,
      dept,
      year,
      isLeader,
      leaderClue,
    };

    await prisma.employee.upsert({
      where: { id },
      update: employee,
      create: employee,
    });
    imported++;
  }

  if (CREATE_TEST_USER) {
    await prisma.employee.upsert({
      where: { id: TEST_AWARDS_USER.id },
      update: TEST_AWARDS_USER,
      create: TEST_AWARDS_USER,
    });
  }

  const matchedLeaders = await prisma.employee.count({ where: { isLeader: true } });
  const unmatchedLeaders = [...leaders.keys()].filter(
    (id) => !dataRows.some((r) => (r[ID] ?? '').trim() === id),
  );

  // Seed TriviaCards. Targets come from the CSV (cols 3+ of each row).
  // When SEED_CREATE_TEST_USER=true, TEST_AWARDS_USER is also connected to
  // every card so that scanning with QA fixture user always yields `match`.
  const cardDrafts = await loadTriviaCards();
  const validEmployeeIds = new Set(
    (await prisma.employee.findMany({ select: { id: true } })).map((e) => e.id),
  );
  const unmatchedTargets: { card: string; ids: string[] }[] = [];
  let totalTargetLinks = 0;

  for (const c of cardDrafts) {
    const present = c.targetIds.filter((id) => validEmployeeIds.has(id));
    const missing = c.targetIds.filter((id) => !validEmployeeIds.has(id));
    if (missing.length) unmatchedTargets.push({ card: c.id, ids: missing });

    const baseIds = CREATE_TEST_USER ? [...present, TEST_AWARDS_USER.id] : present;
    const targets = Array.from(new Set(baseIds)).map((id) => ({ id }));
    totalTargetLinks += present.length;

    await prisma.triviaCard.upsert({
      where: { id: c.id },
      update: { clue: c.clue, targets: { set: targets } },
      create: { id: c.id, clue: c.clue, targets: { connect: targets } },
    });
  }

  console.log(`Seeded ${imported} employees from ${CSV_FILENAME} (skipped ${skipped})`);
  console.log(`Marked ${matchedLeaders} leaders from ${TEAMLEAD_FILENAME}`);
  if (unmatchedLeaders.length) {
    console.warn(`  WARNING: leader IDs not present in employee CSV: ${unmatchedLeaders.join(', ')}`);
  }
  const fixtureSuffix = CREATE_TEST_USER
    ? ` + ${cardDrafts.length} ${TEST_AWARDS_USER.id} fixture links`
    : '';
  console.log(`Seeded ${cardDrafts.length} trivia cards from ${TRIVIA_FILENAME} (${totalTargetLinks} CSV target links${fixtureSuffix})`);
  if (unmatchedTargets.length) {
    console.warn(`  WARNING: target IDs not present in employee CSV (skipped):`);
    for (const { card, ids } of unmatchedTargets) {
      console.warn(`    ${card}: ${ids.join(', ')}`);
    }
  }
  if (CREATE_TEST_USER) {
    console.log(`Seeded test user ${TEST_AWARDS_USER.id} (email "${TEST_AWARDS_USER.email}") — matches every trivia card`);
  } else {
    console.log(`Test user ${TEST_AWARDS_USER.id} skipped (set SEED_CREATE_TEST_USER=true in backend/.env to include)`);
  }

  // Distribute Team Leads to every player as evenly as possible. Each player
  // gets one assignedLeaderId, picked greedily from the leader with the
  // fewest assignments so far (ties broken alphabetically). Self-assignment
  // is skipped, so a leader-player gets one of the other 4 leaders.
  const leaderRows = await prisma.employee.findMany({
    where: { isLeader: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const leaderIds = leaderRows.map((e) => e.id);
  if (leaderIds.length === 0) {
    console.warn('  WARNING: no leaders to assign; skipping leader distribution.');
  } else {
    const allPlayers = await prisma.employee.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const counts: Record<string, number> = Object.fromEntries(leaderIds.map((id) => [id, 0]));
    const distribution: Record<string, string> = {};
    for (const p of allPlayers) {
      const eligible = leaderIds.filter((id) => id !== p.id);
      if (eligible.length === 0) continue;
      eligible.sort((a, b) => counts[a]! - counts[b]! || a.localeCompare(b));
      const chosen = eligible[0]!;
      counts[chosen]++;
      distribution[p.id] = chosen;
    }
    for (const [playerId, leaderId] of Object.entries(distribution)) {
      await prisma.playerProgress.upsert({
        where: { playerId },
        create: { playerId, assignedLeaderId: leaderId },
        update: { assignedLeaderId: leaderId },
      });
    }
    const summary = leaderIds.map((id) => `${id}=${counts[id]}`).join(', ');
    console.log(`Assigned leaders to ${Object.keys(distribution).length} players (${summary})`);
  }

  console.log(`Login: Azure Entra ID SSO (no password). Employees match by company email on first sign-in.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
