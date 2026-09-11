import type { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { deterministicPairId } from './pairId.js';
import { broadcastToUser } from '@/ws/hub.js';
import { isGameEnded } from '@/lib/gameClock.js';
import { getEmployeesByIds } from '@/lib/employeeCache.js';
import { getTriviaCard } from '@/lib/triviaCardCache.js';
import { pickRandomPenaltyId } from '@/lib/penaltyCache.js';

interface ScanInput {
  scannerId: string;
  scannedId: string;
  cardRef?: string;
}

// Teammate matching: everyone hired in 2022 or earlier is treated as one cohort.
// 2023+ employees still match by exact year. Mirror this on the frontend
// when displaying "ปี X" / cohort copy.
const SENIOR_COHORT_CUTOFF = 2023;
export function inSameYearGroup(a: number, b: number): boolean {
  if (a < SENIOR_COHORT_CUTOFF && b < SENIOR_COHORT_CUTOFF) return true;
  return a === b;
}

export interface EmployeeShape {
  id: string;
  name: string;
  initial: string;
  dept: string;
  year: number;
  isLeader: boolean;
  photoUrl: string | null;
}

// Exported so the drift-guard test (`__drift__.test.ts`) can compile-time
// check that the discriminator kinds match the canonical list mirrored in
// `frontend/src/__drift__.test.ts`. Payloads intentionally diverge between
// backend / shared / frontend — only the kind set is mirrored.
export type ScanOutcome =
  | { outcome: 'match'; card_ref?: string; stamp: { id: string; target: EmployeeShape } }
  | { outcome: 'mismatch'; pair_id: string; target: EmployeeShape }
  | { outcome: 'chat'; pair_id: string; target: EmployeeShape }
  | { outcome: 'wrong_year'; target: EmployeeShape }
  | { outcome: 'wrong_leader'; target: EmployeeShape }
  | { outcome: 'leader_clash'; target: EmployeeShape }
  | { outcome: 'already_added'; target: EmployeeShape }
  | { outcome: 'leader_full'; target: EmployeeShape }
  | { outcome: 'teammate_full'; target: EmployeeShape };

export function toEmployeeShape(e: {
  id: string;
  name: string;
  dept: string;
  year: number;
  isLeader?: boolean;
  photoUrl?: string | null;
}): EmployeeShape {
  return {
    id: e.id,
    name: e.name,
    initial: e.name.charAt(0),
    dept: e.dept,
    year: e.year,
    isLeader: e.isLeader === true,
    photoUrl: e.photoUrl ?? null,
  };
}

// Ensure a PlayerProgress row exists for `playerId` so dependent FKs
// (TriviaStamp.playerId, TeammateSlot.playerId, PlayerCardAssignment.playerId)
// have something to point at.
type PrismaLike = Prisma.TransactionClient | typeof prisma;
async function ensurePlayerProgress(playerId: string, client: PrismaLike = prisma): Promise<void> {
  await client.playerProgress.upsert({
    where: { playerId },
    create: { playerId },
    update: {},
  });
}

export async function processScan(input: ScanInput): Promise<ScanOutcome> {
  const { scannerId, scannedId, cardRef } = input;

  if (isGameEnded()) throw new GameEndedError();

  // Scanner + target + card all served from in-memory caches (Employee and
  // TriviaCard are read-only at runtime). The trivia branch hits the DB only
  // inside the transaction below.
  const [employees, card] = await Promise.all([
    getEmployeesByIds([scannerId, scannedId]),
    cardRef ? getTriviaCard(cardRef) : Promise.resolve(null),
  ]);
  const target = employees.find((e) => e.id === scannedId);
  const scanner = employees.find((e) => e.id === scannerId);
  if (!target) throw new NotFoundError('target');
  if (!scanner) throw new NotFoundError('scanner');

  if (cardRef) {
    if (!card) throw new NotFoundError('card');

    if (card.targetIds.includes(scannedId)) {
      // Stamp upsert is per-(playerId, cardId) — concurrent matches on
      // different cards no longer race on a shared JSON column, so the
      // transaction is just for atomicity between the audit Scan row and
      // the TriviaStamp upsert. No per-scanner advisory lock needed.
      const scan = await prisma.$transaction(async (tx) => {
        const created = await tx.scan.create({
          data: {
            scannerId,
            scannedId,
            cardRef: card.id,
            mode: 'TRIVIA',
            outcome: 'MATCH',
          },
        });
        await ensurePlayerProgress(scannerId, tx);
        await tx.triviaStamp.upsert({
          where: { playerId_cardId: { playerId: scannerId, cardId: card.id } },
          create: { playerId: scannerId, cardId: card.id, targetId: scannedId },
          update: { targetId: scannedId, createdAt: new Date() },
        });
        // Bump PlayerProgress.updatedAt — the projector ranking sorts on it
        // and would otherwise stay frozen for a player who only ever stamps
        // (no other PlayerProgress field changes).
        await tx.playerProgress.update({
          where: { playerId: scannerId },
          data: { updatedAt: new Date() },
        });
        return created;
      });
      broadcastToUser(scannedId, {
        type: 'trivia.found',
        cardId: card.id,
        cardClue: card.clue,
        counterpartId: scanner.id,
        counterpartName: scanner.name,
        createdAt: new Date().toISOString(),
      });
      return { outcome: 'match', card_ref: card.id, stamp: { id: scan.id, target: toEmployeeShape(target) } };
    }

    const pairId = deterministicPairId(scannerId, scannedId, 'TRIVIA');
    // Roll the penalty *before* the transaction — pickRandomPenaltyId hits a
    // 60s in-memory cache, no DB round-trip on the hot path.
    const newPenaltyId = await pickRandomPenaltyId();
    // Atomic pair upsert + audit row. Decide newRound inside the tx so the
    // pair + penalty state we read is the same one we update — controls
    // whether we reset confirmed/proof fields and roll a fresh penaltyId
    // on the side-table TriviaPenalty.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.pair.findUnique({
        where: { id: pairId },
        include: { triviaPenalty: true },
      });
      // New round when: no pair yet, prior round was completed, or scan direction
      // flipped (e.g., A scanned B earlier today and now B scans A — the latest
      // mismatcher must become hunter, not stay locked to the first-of-day roles).
      const newRound =
        !existing ||
        existing.triviaPenalty?.targetConfirmed === true ||
        existing.hunterId !== scannerId;
      await tx.pair.upsert({
        where: { id: pairId },
        update: newRound ? { hunterId: scannerId, targetId: scannedId } : {},
        create: {
          id: pairId,
          kind: 'TRIVIA',
          hunterId: scannerId,
          targetId: scannedId,
        },
      });
      if (newRound) {
        // Reset confirmation state and roll a fresh penaltyId.
        await tx.triviaPenalty.upsert({
          where: { pairId },
          create: {
            pairId,
            penaltyId: newPenaltyId,
            targetConfirmed: false,
            proofPhotoUrl: null,
          },
          update: {
            penaltyId: newPenaltyId,
            targetConfirmed: false,
            proofPhotoUrl: null,
          },
        });
      }
      await tx.scan.create({
        data: { scannerId, scannedId, cardRef: card.id, mode: 'TRIVIA', outcome: 'MISMATCH', pairId },
      });
    });
    // Always re-broadcast on mismatch — even when this isn't a new round.
    // The target may have missed the original frame (hidden tab, mobile data
    // blip, app backgrounded). Re-fired pair.created drives the frontend's
    // setPenalty call in useUserSocket, which makes GameShell redirect the
    // target to the penalty page. Hunter side is set by the scanner pre-navigate.
    const createdAt = new Date().toISOString();
    broadcastToUser(scannerId, {
      type: 'pair.created',
      pairId,
      mode: 'trivia',
      role: 'hunter',
      counterpartId: target.id,
      counterpartName: target.name,
      createdAt,
    });
    broadcastToUser(scannedId, {
      type: 'pair.created',
      pairId,
      mode: 'trivia',
      role: 'target',
      counterpartId: scanner.id,
      counterpartName: scanner.name,
      createdAt,
    });
    return { outcome: 'mismatch', pair_id: pairId, target: toEmployeeShape(target) };
  }

  const targetShape = toEmployeeShape(target);
  const existingProgress = await prisma.playerProgress.findUnique({
    where: { playerId: scannerId },
    include: { teammateSlots: { include: { member: { select: { isLeader: true } } } } },
  });

  // Leader path: must scan the leader assigned to this player. Wrong leader is a
  // dead-end like wrong_year (no audit row, no penalty). Year check is bypassed
  // for leaders by design (a leader can be from any year).
  if (targetShape.isLeader) {
    // Leader-vs-leader: a leader scanner cannot recruit another leader.
    // No assigned-leader is given to leader players, so this branch fires
    // before the wrong_leader check.
    if (scanner.isLeader === true) {
      return { outcome: 'leader_clash', target: targetShape };
    }
    if (existingProgress?.assignedLeaderId && existingProgress.assignedLeaderId !== scannedId) {
      return { outcome: 'wrong_leader', target: targetShape };
    }
  } else if (!inSameYearGroup(target.year, scanner.year)) {
    await prisma.scan.create({
      data: { scannerId, scannedId, mode: 'TEAMMATE', outcome: 'MISMATCH' },
    });
    return { outcome: 'wrong_year', target: targetShape };
  }

  const slots = existingProgress?.teammateSlots ?? [];
  if (slots.some((s) => s.memberId === scannedId)) {
    return { outcome: 'already_added', target: targetShape };
  }
  const hasLeader = slots.some((s) => s.member.isLeader);
  const nonLeaderCount = slots.filter((s) => !s.member.isLeader).length;
  if (targetShape.isLeader && hasLeader) {
    return { outcome: 'leader_full', target: targetShape };
  }
  if (!targetShape.isLeader && nonLeaderCount >= 5) {
    return { outcome: 'teammate_full', target: targetShape };
  }

  const pairId = deterministicPairId(scannerId, scannedId, 'TEAMMATE');
  await prisma.$transaction(async (tx) => {
    await tx.pair.upsert({
      where: { id: pairId },
      update: {},
      create: { id: pairId, kind: 'TEAMMATE', hunterId: scannerId, targetId: scannedId },
    });
    await tx.scan.create({
      data: { scannerId, scannedId, mode: 'TEAMMATE', outcome: 'MATCH', pairId },
    });
  });
  // Mutual-add flow: pull the target into /chat/:pairId immediately so they
  // can answer their side of the chat question and add the scanner to their
  // own roster — no scan-back needed. Slot addition itself happens in
  // POST /chat/:pairId/confirm-teammate (one row + one slot per side).
  // The scanner's side state is set locally by ScannerPage on outcome='chat',
  // so we only broadcast to the target.
  broadcastToUser(scannedId, {
    type: 'pair.created',
    pairId,
    mode: 'teammate',
    role: 'target',
    counterpartId: scanner.id,
    counterpartName: scanner.name,
    createdAt: new Date().toISOString(),
  });
  return { outcome: 'chat', pair_id: pairId, target: toEmployeeShape(target) };
}

/**
 * Append a teammate slot to the scanner's roster, enforcing the cap
 * (5 non-leaders + 1 optional leader = 6 total). Idempotent — adding the
 * same teammate twice is a no-op.
 *
 * Returns `true` when a new TeammateSlot row was written, `false` when the
 * call was a no-op (already-present / cap reached / leader-already-set).
 * Callers use the boolean to mirror the slot into a client-side store
 * without re-creating the cap logic on the frontend.
 *
 * The cap is a multi-row condition that can't be expressed as a unique
 * constraint, so we serialize concurrent confirms for the same player on
 * a per-player advisory lock.
 */
export async function addTeammateSlot(playerId: string, emp: EmployeeShape): Promise<boolean> {
  let added = false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${playerId}))`;
    await ensurePlayerProgress(playerId, tx);

    // Already present → no-op (idempotent confirm).
    const existing = await tx.teammateSlot.findUnique({
      where: { playerId_memberId: { playerId, memberId: emp.id } },
    });
    if (existing) return;

    // Cap check via JOIN on Employee.isLeader so we count the *current*
    // leader/non-leader split, not a stale snapshot.
    const slots = await tx.teammateSlot.findMany({
      where: { playerId },
      include: { member: { select: { isLeader: true } } },
    });
    if (slots.length >= 6) return;
    if (emp.isLeader && slots.some((s) => s.member.isLeader)) return;
    if (!emp.isLeader && slots.filter((s) => !s.member.isLeader).length >= 5) return;

    await tx.teammateSlot.create({ data: { playerId, memberId: emp.id } });
    await tx.playerProgress.update({
      where: { playerId },
      data: { updatedAt: new Date() },
    });
    added = true;
  });
  return added;
}

/**
 * Admin override: append a teammate slot ignoring the 5+1 cap. Still holds
 * the same per-player advisory lock so it serializes against the regular
 * scan path, and still dedups by id (no point storing the same employee
 * twice). Returns true if the slot was added, false if the employee was
 * already present.
 *
 * Kept separate from addTeammateSlot so the scan path cannot accidentally
 * pass a `force` flag and exceed the cap.
 */
export async function addTeammateSlotAdmin(
  playerId: string,
  emp: EmployeeShape,
): Promise<boolean> {
  let added = false;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${playerId}))`;
    await ensurePlayerProgress(playerId, tx);
    const existing = await tx.teammateSlot.findUnique({
      where: { playerId_memberId: { playerId, memberId: emp.id } },
    });
    if (existing) return;
    await tx.teammateSlot.create({ data: { playerId, memberId: emp.id } });
    await tx.playerProgress.update({
      where: { playerId },
      data: { updatedAt: new Date() },
    });
    added = true;
  });
  return added;
}

export class NotFoundError extends Error {
  constructor(public resource: string) {
    super(`${resource} not found`);
  }
}

export class GameEndedError extends Error {
  constructor() {
    super('game has ended');
  }
}
