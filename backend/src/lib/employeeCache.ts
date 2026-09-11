// In-memory cache of the entire Employee table. The roster is seeded once
// (~13 rows) and never mutated by any HTTP route — so we load it all at
// once and serve every per-id lookup from a Map. 60s TTL leaves a window
// for `npm run seed` re-runs to take effect without a restart.
//
// The Azure SSO callback hits Prisma directly (lookup by `email`) — it
// doesn't go through this cache because login is a one-shot per session.

import type { Employee } from '@prisma/client';
import { prisma } from '@/db/prisma.js';

const TTL_MS = 60_000;

let cache: { expiresAt: number; byId: Map<string, Employee> } | null = null;
let inflight: Promise<Map<string, Employee>> | null = null;

async function loadAll(): Promise<Map<string, Employee>> {
  const rows = await prisma.employee.findMany();
  const byId = new Map(rows.map((e) => [e.id, e]));
  cache = { expiresAt: Date.now() + TTL_MS, byId };
  return byId;
}

async function getMap(): Promise<Map<string, Employee>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.byId;
  if (inflight) return inflight;
  const p = loadAll().finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const map = await getMap();
  return map.get(id) ?? null;
}

export async function getEmployeesByIds(ids: string[]): Promise<Employee[]> {
  if (ids.length === 0) return [];
  const map = await getMap();
  const out: Employee[] = [];
  for (const id of ids) {
    const e = map.get(id);
    if (e) out.push(e);
  }
  return out;
}

export function invalidateEmployeeCache(): void {
  cache = null;
}
