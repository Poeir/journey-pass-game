// Admin "Sync from HR" — pull the roster from empeo, apply admin-chosen
// filters, diff against the current DB, and apply additions + updates in
// one transaction. Admin-managed fields (isLeader, leaderClue) are NEVER
// touched on update — sync only owns HR-sourced fields.
//
// `missingInApi` (in DB but not in filtered API result) is reported only;
// the row is left alone so leavers / off-roster admins keep their progress.

import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { invalidateEmployeeCache } from '@/lib/employeeCache.js';
import { fetchEmpeoEmployees, type EmpeoEmployee } from '@/lib/empeoClient.js';

export interface EmpeoSyncFilter {
  statusIds?: number[];
  typeIds?: number[];
  orgLevel2?: string[];
  orgLevel3?: string[];
  hiredYearMin?: number;
  hiredYearMax?: number;
  rankPrefixes?: string[];
}

interface MappedRow {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  email: string | null;
  dept: string;
  year: number;
  photoUrl: string | null;
}

const HR_FIELDS = ['name', 'nickname', 'position', 'email', 'dept', 'year', 'photoUrl'] as const;
type HrField = (typeof HR_FIELDS)[number];

export interface SyncResult {
  added: Array<{ id: string; name: string }>;
  updated: Array<{ id: string; name: string; changedFields: HrField[] }>;
  missingInApi: Array<{ id: string; name: string }>;
  errors: Array<{ id?: string; reason: string }>;
  fetchedAt: string;
}

function matchesFilter(row: EmpeoEmployee, f: EmpeoSyncFilter): boolean {
  const wi = row.workingInformation ?? {};
  if (f.statusIds?.length && (wi.statusId == null || !f.statusIds.includes(wi.statusId))) {
    return false;
  }
  if (f.typeIds?.length && (wi.typeId == null || !f.typeIds.includes(wi.typeId))) {
    return false;
  }
  if (f.orgLevel2?.length) {
    const v = wi.organization?.level2 ?? '';
    if (!f.orgLevel2.some((x) => x.toLowerCase() === v.toLowerCase())) return false;
  }
  if (f.orgLevel3?.length) {
    const v = wi.organization?.level3 ?? '';
    if (!f.orgLevel3.some((x) => x.toLowerCase() === v.toLowerCase())) return false;
  }
  if (f.rankPrefixes?.length) {
    const r = wi.rank ?? '';
    if (!f.rankPrefixes.some((p) => r.startsWith(p))) return false;
  }
  if (f.hiredYearMin != null || f.hiredYearMax != null) {
    const y = row.dateHired ? new Date(row.dateHired).getUTCFullYear() : NaN;
    if (Number.isNaN(y)) return false;
    if (f.hiredYearMin != null && y < f.hiredYearMin) return false;
    if (f.hiredYearMax != null && y > f.hiredYearMax) return false;
  }
  return true;
}

function mapEmpeoRow(row: EmpeoEmployee): MappedRow | { error: string } {
  const id = row.employeeRefId?.trim();
  if (!id) return { error: 'missing_employeeRefId' };

  const nameEn = `${row.firstNameEN ?? ''} ${row.lastNameEN ?? ''}`.trim();
  const nameTh = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
  const name = nameEn || nameTh;
  if (!name) return { error: `missing_name (${id})` };

  const wi = row.workingInformation ?? {};
  const dept = wi.organization?.level3 ?? wi.organization?.level2 ?? 'Unknown';

  let year = 0;
  if (row.dateHired) {
    const parsed = new Date(row.dateHired).getUTCFullYear();
    if (!Number.isNaN(parsed)) year = parsed;
  }

  return {
    id,
    name,
    nickname: row.nickNameEN?.trim() || row.nickName?.trim() || null,
    position: wi.position?.trim() || null,
    email: wi.emailAddress?.trim().toLowerCase() || null,
    dept,
    year,
    photoUrl: wi.imagePath?.trim() || null,
  };
}

function diffFields(existing: MappedRow, next: MappedRow): HrField[] {
  const changed: HrField[] = [];
  for (const f of HR_FIELDS) {
    if (existing[f] !== next[f]) changed.push(f);
  }
  return changed;
}

export async function syncEmployees(filters: EmpeoSyncFilter): Promise<SyncResult> {
  // Fetch + map OUTSIDE the transaction — network calls inside a Prisma
  // transaction race the 5s txn timeout and would also hold a connection.
  const fetched = await fetchEmpeoEmployees();

  const mapped: MappedRow[] = [];
  const errors: SyncResult['errors'] = [];
  for (const row of fetched) {
    if (!matchesFilter(row, filters)) continue;
    const m = mapEmpeoRow(row);
    if ('error' in m) {
      errors.push({ id: row.employeeRefId, reason: m.error });
      continue;
    }
    mapped.push(m);
  }

  const mappedById = new Map(mapped.map((m) => [m.id, m]));

  const existing = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      nickname: true,
      position: true,
      email: true,
      dept: true,
      year: true,
      photoUrl: true,
    },
  });
  const existingById = new Map<string, MappedRow>(
    existing.map((e) => [
      e.id,
      {
        id: e.id,
        name: e.name,
        nickname: e.nickname,
        position: e.position,
        email: e.email,
        dept: e.dept,
        year: e.year,
        photoUrl: e.photoUrl,
      },
    ]),
  );

  const toCreate: MappedRow[] = [];
  const toUpdate: Array<{ row: MappedRow; changedFields: HrField[] }> = [];
  for (const m of mapped) {
    const prev = existingById.get(m.id);
    if (!prev) {
      toCreate.push(m);
      continue;
    }
    const changed = diffFields(prev, m);
    if (changed.length) toUpdate.push({ row: m, changedFields: changed });
  }

  const missingInApi = existing
    .filter((e) => !mappedById.has(e.id))
    .map((e) => ({ id: e.id, name: e.name }));

  // Wrap writes in a transaction so two concurrent admin clicks serialize
  // on the advisory lock — without it, both could P2002 on email.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-sync'))`;

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
            photoUrl: m.photoUrl,
            // isLeader / leaderClue intentionally left at default — admin
            // owns those and the sync update path also skips them.
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
      try {
        await tx.employee.update({
          where: { id: m.id },
          // Allowlist: only HR-owned fields. isLeader / leaderClue are
          // deliberately excluded — admin owns those.
          data: {
            name: m.name,
            nickname: m.nickname,
            position: m.position,
            email: m.email,
            dept: m.dept,
            year: m.year,
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
  });

  invalidateEmployeeCache();

  return {
    added: toCreate.map((m) => ({ id: m.id, name: m.name })),
    updated: toUpdate.map(({ row, changedFields }) => ({
      id: row.id,
      name: row.name,
      changedFields,
    })),
    missingInApi,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}
