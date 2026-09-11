// Admin portal routes — every endpoint in this file is intended to be
// admin-gated. Today the gate is a no-op (`requireAdmin` placeholder); when
// the role model is decided, that one function fills in and the gate is live
// across every route here without further wiring.
//
// Schema gotcha: response schemas are intentionally loose (`additionalProperties:
// true`) so we can reshape rows without churning the route file. Strict input
// schemas only where the request shape matters (params, body create/update).

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { requireAdmin } from '@/middleware/auth.js';
import {
  getEmployee,
  getEmployeesByIds,
  invalidateEmployeeCache,
} from '@/lib/employeeCache.js';
import {
  deriveCardIndex,
  getTriviaCard,
  invalidateTriviaCardCache,
} from '@/lib/triviaCardCache.js';
import { addTeammateSlotAdmin, type EmployeeShape as DomainEmployeeShape } from '@/domain/scan.js';
import { syncEmployees, type EmpeoSyncFilter } from '@/domain/employeeSync.js';
import { CsvParseError, importEmployeesFromCsv } from '@/domain/employeeCsvImport.js';
import { EmpeoAuthError, EmpeoNetworkError, EmpeoServerError, isHrConfigured } from '@/lib/empeoClient.js';
import { destroyImage } from '@/lib/cloudinary.js';
import { invalidate } from '@/lib/ttlCache.js';
import { gameEndAt, isGameEnded } from '@/lib/gameClock.js';
import { invalidatePenaltyCache } from '@/lib/penaltyCache.js';
import { invalidatePhotoPlaceCache } from '@/lib/photoPlaceCache.js';
import { invalidateChatQuestionCache } from '@/domain/chatQuestions.js';
import { randomBytes } from 'node:crypto';
import {
  broadcast,
  broadcastGameEnded,
  broadcastToUser,
} from '@/ws/hub.js';
import { MEMORIES_WALL_CACHE } from './memories.js';

const COMPLETION_CACHE_KEY = 'completion:ranking';
const TRIVIA_TOTAL = 5;
const TEAMMATE_TOTAL = 5;

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const idParam = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

// Wire format the admin pages consume directly via `adminEndpoints`. Mirror of
// the `Employee` shape with derived `initial` so the frontend doesn't recompute.
interface EmployeeShape {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  email: string | null;
  initial: string;
  dept: string;
  year: number;
  isLeader: boolean;
  photoUrl: string | null;
}

function shapeEmployee(
  e: {
    id: string;
    name: string;
    nickname?: string | null;
    position?: string | null;
    email?: string | null;
    dept: string;
    year: number;
    isLeader: boolean;
    photoUrl?: string | null;
  },
): EmployeeShape {
  return {
    id: e.id,
    name: e.name,
    nickname: e.nickname ?? null,
    position: e.position ?? null,
    email: e.email ?? null,
    initial: e.name.charAt(0).toUpperCase(),
    dept: e.dept,
    year: e.year,
    isLeader: e.isLeader,
    photoUrl: e.photoUrl ?? null,
  };
}

// Hydrate a teammate slot row (just (playerId, memberId)) into the
// EmployeeShape the admin UI already expects. Skips rows whose member was
// deleted from the cache snapshot — defensive; FK should keep this in sync.
function shapeSlots(
  rows: Array<{ memberId: string }>,
  empMap: Map<string, {
    id: string;
    name: string;
    nickname: string | null;
    position: string | null;
    dept: string;
    year: number;
    isLeader: boolean;
    photoUrl: string | null;
  }>,
): EmployeeShape[] {
  const out: EmployeeShape[] = [];
  for (const row of rows) {
    const e = empMap.get(row.memberId);
    if (e) out.push(shapeEmployee(e));
  }
  return out;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Apply the admin gate to every route registered on this plugin instance.
  // Today `requireAdmin` is a no-op; flipping it on later will gate everything
  // here without per-route changes.
  app.addHook('preHandler', requireAdmin);

  //
  // ─── Dashboard ───────────────────────────────────────────────────
  //
  app.get(
    '/admin/dashboard',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Aggregate stats + recent activity for the admin home screen',
      },
    },
    async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [totalPlayers, eligiblePlayers, allProgress, activePairs, scansToday, memoriesUploaded, recentScansRaw, activePairsRaw] =
        await Promise.all([
          prisma.employee.count(),
          // "Eligible" = non-leader employees. Leaders are scan targets, not
          // active players, so they shouldn't contribute 10 quests each to
          // the totalQuests denominator (otherwise the dashboard caps near
          // ~98% on a complete event).
          prisma.employee.count({ where: { isLeader: false } }),
          prisma.playerProgress.findMany({
            select: {
              completedAt: true,
              _count: {
                select: {
                  triviaStamps: true,
                  // Total slot count (any role) — used for the "playing" check.
                  teammateSlots: true,
                },
              },
              // Separate count for non-leader members only — drives quest progress.
              teammateSlots: {
                where: { member: { isLeader: false } },
                select: { memberId: true },
              },
            },
          }),
          // "Active" = a trivia pair whose penalty round hasn't been
          // confirmed. Teammate pairs never have a TriviaPenalty row so they
          // don't show up here, which is the desired behavior — confirmed
          // teammate pairs aren't pending anything.
          prisma.pair.count({ where: { triviaPenalty: { is: { targetConfirmed: false } } } }),
          prisma.scan.count({ where: { createdAt: { gte: todayStart } } }),
          prisma.memoryPhoto.count(),
          prisma.scan.findMany({
            orderBy: { createdAt: 'desc' },
            take: 6,
            include: {
              scanner: { select: { id: true, name: true } },
              target: { select: { id: true, name: true } },
            },
          }),
          prisma.pair.findMany({
            where: { triviaPenalty: { is: { targetConfirmed: false } } },
            orderBy: { createdAt: 'desc' },
            take: 8,
            include: {
              triviaPenalty: { include: { penalty: { select: { id: true, text: true } } } },
            },
          }),
        ]);

      let finished = 0;
      let playing = 0;
      let completedQuests = 0;
      for (const p of allProgress) {
        const triviaCount = p._count.triviaStamps;
        const slotCount = p._count.teammateSlots;
        const memberCount = p.teammateSlots.length;
        completedQuests += Math.min(TRIVIA_TOTAL, triviaCount) + Math.min(TEAMMATE_TOTAL, memberCount);
        if (p.completedAt) finished += 1;
        else if (triviaCount > 0 || slotCount > 0) playing += 1;
      }
      const notStarted = totalPlayers - finished - playing;

      const pairEmpIds = new Set<string>();
      for (const p of activePairsRaw) {
        pairEmpIds.add(p.hunterId);
        pairEmpIds.add(p.targetId);
      }
      const pairEmps = await getEmployeesByIds([...pairEmpIds]);
      const pairEmpMap = new Map(pairEmps.map((e) => [e.id, e]));

      return {
        totalPlayers,
        finished,
        playing,
        notStarted: Math.max(0, notStarted),
        activePairs,
        scansToday,
        memoriesUploaded,
        completedQuests,
        totalQuests: eligiblePlayers * (TRIVIA_TOTAL + TEAMMATE_TOTAL),
        gameEndAt: gameEndAt().toISOString(),
        isGameEnded: isGameEnded(),
        recentScans: recentScansRaw.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          mode: s.mode,
          outcome: s.outcome,
          cardRef: s.cardRef,
          pairId: s.pairId,
          scanner: { id: s.scanner.id, name: s.scanner.name },
          target: { id: s.target.id, name: s.target.name },
        })),
        activePairsList: activePairsRaw.map((p) => {
          const hunter = pairEmpMap.get(p.hunterId);
          const target = pairEmpMap.get(p.targetId);
          const tp = p.triviaPenalty;
          return {
            id: p.id,
            kind: p.kind,
            createdAt: p.createdAt.toISOString(),
            penalty: tp?.penalty ? { id: tp.penalty.id, text: tp.penalty.text } : null,
            targetConfirmed: tp?.targetConfirmed ?? false,
            proofPhotoUrl: tp?.proofPhotoUrl ?? null,
            hunter: hunter ? shapeEmployee(hunter) : null,
            target: target ? shapeEmployee(target) : null,
          };
        }),
      };
    },
  );

  //
  // ─── Players ─────────────────────────────────────────────────────
  //
  app.get(
    '/admin/players',
    {
      schema: {
        tags: ['Admin'],
        summary: 'List every employee with their PlayerProgress',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            status: { type: 'string', enum: ['all', 'finished', 'playing', 'not_started'] },
          },
        },
      },
    },
    async (req) => {
      const { q, status } = req.query as { q?: string; status?: string };
      const employees = await prisma.employee.findMany({
        include: {
          progress: {
            include: {
              triviaStamps: { select: { cardId: true, targetId: true } },
              teammateSlots: {
                orderBy: { createdAt: 'asc' },
                include: { member: true },
              },
              assignedCards: {
                orderBy: { position: 'asc' },
                select: { cardId: true },
              },
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      const rows = employees
        .map((e) => {
          const stampsRows = e.progress?.triviaStamps ?? [];
          const slotsRows = e.progress?.teammateSlots ?? [];
          const triviaStamps: Record<string, string> = {};
          for (const s of stampsRows) triviaStamps[s.cardId] = s.targetId;
          const teammateSlots = slotsRows.map((s) => shapeEmployee(s.member));
          const triviaCount = stampsRows.length;
          const memberCount = teammateSlots.filter((s) => !s.isLeader).length;
          const hasLeader = teammateSlots.some((s) => s.isLeader);
          // Mirror frontend selectIsComplete in gameStore.ts: leader is bonus
          // and does NOT count toward completion. Cap each side at 5.
          const pct = Math.round(
            ((Math.min(TRIVIA_TOTAL, triviaCount) + Math.min(TEAMMATE_TOTAL, memberCount)) /
              (TRIVIA_TOTAL + TEAMMATE_TOTAL)) *
              100,
          );
          return {
            player: shapeEmployee(e),
            triviaStamps,
            teammateSlots,
            assignedCardIds: e.progress?.assignedCards.map((a) => a.cardId) ?? [],
            assignedLeaderId: e.progress?.assignedLeaderId ?? null,
            completedAt: e.progress?.completedAt?.toISOString() ?? null,
            updatedAt: e.progress?.updatedAt?.toISOString() ?? e.createdAt.toISOString(),
            triviaCount,
            memberCount,
            hasLeader,
            pct,
          };
        })
        .filter((row) => {
          if (q) {
            const needle = q.toLowerCase();
            const hay = `${row.player.name} ${row.player.id} ${row.player.dept}`.toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          const triviaCount = Object.keys(row.triviaStamps).length;
          const slotCount = row.teammateSlots.length;
          if (status === 'finished') return !!row.completedAt;
          if (status === 'playing') return !row.completedAt && (triviaCount > 0 || slotCount > 0);
          if (status === 'not_started') return !row.completedAt && triviaCount === 0 && slotCount === 0;
          return true;
        });

      return { players: rows };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/players/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      const employee = await prisma.employee.findUnique({
        where: { id: req.params.id },
        include: {
          progress: {
            include: {
              triviaStamps: { select: { cardId: true, targetId: true } },
              teammateSlots: {
                orderBy: { createdAt: 'asc' },
                include: { member: true },
              },
              assignedCards: {
                orderBy: { position: 'asc' },
                select: { cardId: true },
              },
            },
          },
        },
      });
      if (!employee) return reply.code(404).send({ error: 'not_found' });

      const stampsRows = employee.progress?.triviaStamps ?? [];
      const triviaStamps: Record<string, string> = {};
      for (const s of stampsRows) triviaStamps[s.cardId] = s.targetId;

      const teammateSlots = (employee.progress?.teammateSlots ?? []).map((s) => shapeEmployee(s.member));
      const assignedCardIds = employee.progress?.assignedCards.map((a) => a.cardId) ?? [];
      const assignedLeaderId = employee.progress?.assignedLeaderId ?? null;

      // Resolve referenced ids in parallel.
      const cardLookups = await Promise.all(
        assignedCardIds.map((cid) => getTriviaCard(cid)),
      );
      const stampedByIds = stampsRows.map((s) => s.targetId);
      const stampers = stampedByIds.length
        ? await getEmployeesByIds(stampedByIds)
        : [];
      const assignedLeader = assignedLeaderId ? await getEmployee(assignedLeaderId) : null;

      const stampedByMap = new Map(stampers.map((e) => [e.id, shapeEmployee(e)]));

      return {
        player: shapeEmployee(employee),
        triviaStamps,
        teammateSlots,
        assignedCardIds,
        assignedLeaderId,
        assignedLeader: assignedLeader ? shapeEmployee(assignedLeader) : null,
        assignedCards: cardLookups
          .filter((c): c is NonNullable<typeof c> => !!c)
          .map((c) => ({ id: c.id, index: c.index, clue: c.clue, targetIds: c.targetIds })),
        stampedBy: Object.fromEntries(
          Object.entries(triviaStamps).map(([cid, eid]) => [
            cid,
            stampedByMap.get(eid) ?? null,
          ]),
        ),
        completedAt: employee.progress?.completedAt?.toISOString() ?? null,
        updatedAt: employee.progress?.updatedAt?.toISOString() ?? employee.createdAt.toISOString(),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/players/:id/complete',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      const exists = await prisma.employee.findUnique({ where: { id: req.params.id } });
      if (!exists) return reply.code(404).send({ error: 'not_found' });
      const progress = await prisma.playerProgress.upsert({
        where: { playerId: req.params.id },
        create: { playerId: req.params.id, completedAt: new Date() },
        update: { completedAt: new Date() },
      });
      invalidate(COMPLETION_CACHE_KEY);
      return { completedAt: progress.completedAt!.toISOString() };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/players/:id/complete',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      const progress = await prisma.playerProgress.findUnique({
        where: { playerId: req.params.id },
      });
      if (!progress) return reply.code(404).send({ error: 'not_found' });
      await prisma.playerProgress.update({
        where: { playerId: req.params.id },
        data: { completedAt: null },
      });
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/players/:id/progress',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Reset stamps + teammate slots + completedAt (keeps assignedCards/Leader)',
        params: idParam,
      },
    },
    async (req, reply) => {
      const exists = await prisma.playerProgress.findUnique({
        where: { playerId: req.params.id },
      });
      if (!exists) return reply.code(404).send({ error: 'not_found' });
      await prisma.$transaction([
        prisma.triviaStamp.deleteMany({ where: { playerId: req.params.id } }),
        prisma.teammateSlot.deleteMany({ where: { playerId: req.params.id } }),
        // Wipe the player's chat answers across all TEAMMATE pairs so a
        // post-reset auto-redirect into /chat/:pairId starts from a fresh
        // form instead of the "already answered, waiting" state.
        prisma.chatAnswer.deleteMany({
          where: {
            answererId: req.params.id,
            pair: { kind: 'TEAMMATE' },
          },
        }),
        prisma.playerProgress.update({
          where: { playerId: req.params.id },
          data: { completedAt: null },
        }),
      ]);
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true };
    },
  );

  //
  // ─── Player overrides (admin force-grant / revoke) ──────────────
  //
  // Stamp upserts/deletes are per-row and atomic; only the teammate-slot
  // path still needs the advisory lock, since the cap check spans rows.
  // Admin force-add bypasses the cap by design (see addTeammateSlotAdmin).

  app.post<{ Params: { id: string }; Body: { cardId: string; targetId: string } }>(
    '/admin/players/:id/stamp',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Force-grant a trivia stamp on a player',
        params: idParam,
        body: {
          type: 'object',
          properties: {
            cardId: { type: 'string', minLength: 1 },
            targetId: { type: 'string', minLength: 1 },
          },
          required: ['cardId', 'targetId'],
        },
      },
    },
    async (req, reply) => {
      const { cardId, targetId } = req.body;
      const playerId = req.params.id;
      const [player, card, target] = await Promise.all([
        prisma.employee.findUnique({ where: { id: playerId }, select: { id: true } }),
        getTriviaCard(cardId),
        getEmployee(targetId),
      ]);
      if (!player) return reply.code(404).send({ error: 'player_not_found' });
      if (!card) return reply.code(404).send({ error: 'card_not_found' });
      if (!target) return reply.code(404).send({ error: 'target_not_found' });

      await prisma.$transaction(async (tx) => {
        await tx.playerProgress.upsert({
          where: { playerId },
          create: { playerId },
          update: {},
        });
        await tx.triviaStamp.upsert({
          where: { playerId_cardId: { playerId, cardId } },
          create: { playerId, cardId, targetId },
          update: { targetId, createdAt: new Date() },
        });
        await tx.playerProgress.update({
          where: { playerId },
          data: { updatedAt: new Date() },
        });
      });
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true, stamp: { cardId, targetId } };
    },
  );

  app.delete<{ Params: { id: string; cardId: string } }>(
    '/admin/players/:id/stamp/:cardId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Revoke a trivia stamp on a player',
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, cardId: { type: 'string' } },
          required: ['id', 'cardId'],
        },
      },
    },
    async (req, reply) => {
      const { id: playerId, cardId } = req.params;
      const progress = await prisma.playerProgress.findUnique({ where: { playerId } });
      if (!progress) return reply.code(404).send({ error: 'player_progress_not_found' });
      try {
        await prisma.$transaction([
          prisma.triviaStamp.delete({
            where: { playerId_cardId: { playerId, cardId } },
          }),
          prisma.playerProgress.update({
            where: { playerId },
            data: { updatedAt: new Date() },
          }),
        ]);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'stamp_not_found' });
        }
        throw err;
      }
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { employeeId: string } }>(
    '/admin/players/:id/teammate',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Force-add a teammate slot, bypassing the 5+1 cap',
        params: idParam,
        body: {
          type: 'object',
          properties: { employeeId: { type: 'string', minLength: 1 } },
          required: ['employeeId'],
        },
      },
    },
    async (req, reply) => {
      const playerId = req.params.id;
      const { employeeId } = req.body;
      if (playerId === employeeId) {
        return reply.code(400).send({ error: 'cannot_add_self' });
      }
      const [player, mate] = await Promise.all([
        prisma.employee.findUnique({ where: { id: playerId }, select: { id: true } }),
        getEmployee(employeeId),
      ]);
      if (!player) return reply.code(404).send({ error: 'player_not_found' });
      if (!mate) return reply.code(404).send({ error: 'employee_not_found' });

      const empShape: DomainEmployeeShape = {
        id: mate.id,
        name: mate.name,
        initial: mate.name.charAt(0).toUpperCase(),
        dept: mate.dept,
        year: mate.year,
        isLeader: mate.isLeader,
        photoUrl: mate.photoUrl ?? null,
      };
      const added = await addTeammateSlotAdmin(playerId, empShape);
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true, added, teammate: shapeEmployee(mate) };
    },
  );

  app.delete<{ Params: { id: string; employeeId: string } }>(
    '/admin/players/:id/teammate/:employeeId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Remove a teammate pairing — wipes BOTH slots + all chat answers',
        description:
          'Teammate slots are mutual: the chat-confirm flow adds A→B and B→A in the same transaction. Removing only one side leaves stale ChatAnswer rows whose `bothAnswered` check would re-add the missing slot the next time either side re-submits. So this route always nukes the relationship symmetrically: A→B slot, B→A slot (if present), and every ChatAnswer row across all TEAMMATE pairs between A and B.',
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, employeeId: { type: 'string' } },
          required: ['id', 'employeeId'],
        },
      },
    },
    async (req, reply) => {
      const { id: playerId, employeeId } = req.params;
      const progress = await prisma.playerProgress.findUnique({ where: { playerId } });
      if (!progress) return reply.code(404).send({ error: 'player_progress_not_found' });

      // Snapshot what's currently linked so the response can report the full
      // blast radius (helps the admin UI surface a clear "removed X" toast).
      const [slotForward, slotReverse] = await Promise.all([
        prisma.teammateSlot.findUnique({
          where: { playerId_memberId: { playerId, memberId: employeeId } },
        }),
        prisma.teammateSlot.findUnique({
          where: { playerId_memberId: { playerId: employeeId, memberId: playerId } },
        }),
      ]);

      // Mutual delete: slots both directions + every TEAMMATE pair between
      // them (both directions). Pair delete cascades ChatAnswer, so re-
      // confirm can't resurrect the slots, AND /me/pending-chat returns
      // null on next hydrate so neither side gets auto-redirected back to
      // /chat/:pairId. Audit is preserved on Scan rows (Scan.pairId has
      // ON DELETE SET NULL — the row stays with scanner/target/mode/outcome).
      const [slotsDel, pairsDel] = await prisma.$transaction([
        prisma.teammateSlot.deleteMany({
          where: {
            OR: [
              { playerId, memberId: employeeId },
              { playerId: employeeId, memberId: playerId },
            ],
          },
        }),
        prisma.pair.deleteMany({
          where: {
            kind: 'TEAMMATE',
            OR: [
              { hunterId: playerId, targetId: employeeId },
              { hunterId: employeeId, targetId: playerId },
            ],
          },
        }),
        prisma.playerProgress.updateMany({
          where: { playerId: { in: [playerId, employeeId] } },
          data: { updatedAt: new Date() },
        }),
      ]);

      invalidate(COMPLETION_CACHE_KEY);

      // No broadcast: admin removing a teammate means "this pairing is
      // over" — the affected players should NOT be auto-redirected back
      // into /chat/:pairId to re-confirm. /me/pending-chat will now
      // return null because the pair is gone. If either side is currently
      // sitting on ChatConfirmPage, their next submit will 404 (pair
      // deleted) and they'll see the standard error toast — acceptable
      // edge case for an admin override.

      return {
        ok: true,
        removed: !!slotForward,
        removedReverse: !!slotReverse,
        slotsDeleted: slotsDel.count,
        pairsDeleted: pairsDel.count,
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { leaderId: string | null } }>(
    '/admin/players/:id/assigned-leader',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Set or clear the leader this player must scan',
        params: idParam,
        body: {
          type: 'object',
          properties: { leaderId: { type: ['string', 'null'] } },
          required: ['leaderId'],
        },
      },
    },
    async (req, reply) => {
      const playerId = req.params.id;
      const { leaderId } = req.body;
      const player = await prisma.employee.findUnique({
        where: { id: playerId },
        select: { id: true },
      });
      if (!player) return reply.code(404).send({ error: 'player_not_found' });

      if (leaderId !== null) {
        const leader = await getEmployee(leaderId);
        if (!leader) return reply.code(404).send({ error: 'leader_not_found' });
        if (!leader.isLeader) return reply.code(400).send({ error: 'not_a_leader' });
      }

      await prisma.playerProgress.upsert({
        where: { playerId },
        create: { playerId, assignedLeaderId: leaderId },
        update: { assignedLeaderId: leaderId },
      });
      return { ok: true, assignedLeaderId: leaderId };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/players/:id/assigned-cards/reroll',
    {
      schema: {
        tags: ['Admin'],
        summary:
          'Clear assignedCardIds + triviaStamps; next /missions/trivia/start picks a fresh 5',
        params: idParam,
      },
    },
    async (req, reply) => {
      const playerId = req.params.id;
      const player = await prisma.employee.findUnique({
        where: { id: playerId },
        select: { id: true },
      });
      if (!player) return reply.code(404).send({ error: 'player_not_found' });

      // Clear stamps too — leaving them would inflate the player's progress
      // count against cards they no longer own. The next time the player
      // opens the trivia mission, /missions/trivia/start picks 5 new cards.
      await prisma.$transaction([
        prisma.playerProgress.upsert({
          where: { playerId },
          create: { playerId },
          update: {},
        }),
        prisma.playerCardAssignment.deleteMany({ where: { playerId } }),
        prisma.triviaStamp.deleteMany({ where: { playerId } }),
        prisma.playerProgress.update({
          where: { playerId },
          data: { updatedAt: new Date() },
        }),
      ]);
      invalidate(COMPLETION_CACHE_KEY);
      return { ok: true };
    },
  );

  //
  // ─── Employees ───────────────────────────────────────────────────
  //
  app.get(
    '/admin/employees',
    {
      schema: {
        tags: ['Admin'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            role: { type: 'string', enum: ['all', 'leaders', 'members'] },
          },
        },
      },
    },
    async (req) => {
      const { q, role } = req.query as { q?: string; role?: string };
      const where: Prisma.EmployeeWhereInput = {};
      if (role === 'leaders') where.isLeader = true;
      if (role === 'members') where.isLeader = false;
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { id: { contains: q, mode: 'insensitive' } },
          { dept: { contains: q, mode: 'insensitive' } },
        ];
      }
      const rows = await prisma.employee.findMany({ where, orderBy: { id: 'asc' } });
      return { employees: rows.map(shapeEmployee).map((e, i) => ({ ...e, leaderClue: rows[i].leaderClue ?? null })) };
    },
  );

  const employeeBodySchema = {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      nickname: { type: ['string', 'null'] },
      position: { type: ['string', 'null'] },
      email: { type: ['string', 'null'], format: 'email' },
      dept: { type: 'string' },
      year: { type: 'integer' },
      isLeader: { type: 'boolean' },
      leaderClue: { type: ['string', 'null'] },
      photoUrl: { type: ['string', 'null'] },
    },
  } as const;

  app.post(
    '/admin/employees',
    {
      schema: {
        tags: ['Admin'],
        body: { ...employeeBodySchema, required: ['id', 'name', 'dept', 'year'] },
        response: { 201: { type: 'object', additionalProperties: true }, 409: errorSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as Prisma.EmployeeCreateInput & { leaderClue?: string | null };
      try {
        const created = await prisma.employee.create({
          data: {
            id: body.id,
            name: body.name,
            nickname: body.nickname ?? null,
            position: body.position ?? null,
            email: body.email ?? null,
            dept: body.dept,
            year: body.year,
            isLeader: body.isLeader ?? false,
            leaderClue: body.leaderClue ?? null,
            photoUrl: body.photoUrl ?? null,
          },
        });
        invalidateEmployeeCache();
        return reply.code(201).send(shapeEmployee(created));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = err.meta?.target;
          const fields = Array.isArray(target) ? target : [];
          const code = fields.includes('email') ? 'duplicate_email' : 'duplicate_id';
          return reply.code(409).send({ error: code });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/employees/:id',
    {
      schema: {
        tags: ['Admin'],
        params: idParam,
        body: employeeBodySchema,
      },
    },
    async (req, reply) => {
      const body = req.body as Partial<Prisma.EmployeeUpdateInput> & { leaderClue?: string | null };
      try {
        const updated = await prisma.employee.update({
          where: { id: req.params.id },
          data: {
            name: body.name,
            nickname: body.nickname,
            position: body.position,
            email: body.email,
            dept: body.dept,
            year: body.year,
            isLeader: body.isLeader,
            leaderClue: body.leaderClue,
            photoUrl: body.photoUrl,
          },
        });
        invalidateEmployeeCache();
        return shapeEmployee(updated);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            return reply.code(404).send({ error: 'not_found' });
          }
          if (err.code === 'P2002') {
            const target = err.meta?.target;
            const fields = Array.isArray(target) ? target : [];
            const code = fields.includes('email') ? 'duplicate_email' : 'duplicate_id';
            return reply.code(409).send({ error: code });
          }
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/employees/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      try {
        await prisma.employee.delete({ where: { id: req.params.id } });
        invalidateEmployeeCache();
        invalidate(COMPLETION_CACHE_KEY);
        return { ok: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  // Pull roster from empeo HR API and upsert into Employee table. Admin sets
  // filters in the request body; isLeader/leaderClue are never touched on
  // update (sync only owns HR-sourced fields).
  const empeoSyncFilterSchema = {
    type: 'object',
    properties: {
      statusIds: { type: 'array', items: { type: 'integer' } },
      typeIds: { type: 'array', items: { type: 'integer' } },
      orgLevel2: { type: 'array', items: { type: 'string' } },
      orgLevel3: { type: 'array', items: { type: 'string' } },
      hiredYearMin: { type: 'integer' },
      hiredYearMax: { type: 'integer' },
      rankPrefixes: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  } as const;

  app.post(
    '/admin/employees/sync',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Sync employees from empeo HR API',
        body: empeoSyncFilterSchema,
        response: {
          200: { type: 'object', additionalProperties: true },
          502: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!isHrConfigured()) {
        return reply.code(503).send({ error: 'hr_api_not_configured' });
      }
      try {
        const result = await syncEmployees(req.body as EmpeoSyncFilter);
        invalidate(COMPLETION_CACHE_KEY);
        return result;
      } catch (err) {
        if (err instanceof EmpeoAuthError) {
          req.log.warn({ err: err.message }, 'empeo auth failed');
          return reply.code(502).send({ error: 'hr_auth' });
        }
        if (err instanceof EmpeoServerError || err instanceof EmpeoNetworkError) {
          req.log.warn({ err: err.message }, 'empeo unavailable');
          return reply.code(502).send({ error: 'hr_unavailable' });
        }
        throw err;
      }
    },
  );

  // Import roster from an uploaded CSV. Unlike the empeo sync, this path
  // CAN write isLeader / leaderClue (admin supplies the values directly).
  // Multipart with a `csv` file. Accepts up to ~2 MB of CSV (well below
  // the global 8 MB multipart cap configured in server.ts).
  app.post(
    '/admin/employees/import-csv',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Import employees from an uploaded CSV',
        consumes: ['multipart/form-data'],
        response: {
          200: { type: 'object', additionalProperties: true },
          400: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'missing_csv' });
      const buf = await file.toBuffer();
      const text = buf.toString('utf-8').replace(/^﻿/, ''); // strip BOM
      try {
        const result = await importEmployeesFromCsv(text);
        invalidate(COMPLETION_CACHE_KEY);
        return result;
      } catch (err) {
        if (err instanceof CsvParseError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  //
  // ─── Trivia cards ────────────────────────────────────────────────
  //
  app.get(
    '/admin/trivia',
    { schema: { tags: ['Admin'] } },
    async () => {
      const cards = await prisma.triviaCard.findMany({
        include: {
          targets: true,
          _count: { select: { assignments: true, stamps: true } },
        },
        orderBy: { id: 'asc' },
      });

      return {
        cards: cards.map((c) => ({
          id: c.id,
          index: deriveCardIndex(c.id),
          clue: c.clue,
          targets: c.targets.map(shapeEmployee),
          assignedToCount: c._count.assignments,
          stampedCount: c._count.stamps,
        })),
      };
    },
  );

  const triviaBodySchema = {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      index: { type: 'integer' },
      clue: { type: 'string', minLength: 1 },
      targetIds: { type: 'array', items: { type: 'string' } },
    },
  } as const;

  app.post(
    '/admin/trivia',
    {
      schema: {
        tags: ['Admin'],
        body: { ...triviaBodySchema, required: ['id', 'index', 'clue'] },
      },
    },
    async (req, reply) => {
      const body = req.body as { id: string; index?: number; clue: string; targetIds?: string[] };
      // body.index is accepted for back-compat with the admin UI's create form
      // but ignored — the display number is derived from the id on read.
      try {
        const created = await prisma.triviaCard.create({
          data: {
            id: body.id,
            clue: body.clue,
            targets: body.targetIds?.length
              ? { connect: body.targetIds.map((id) => ({ id })) }
              : undefined,
          },
          include: { targets: true },
        });
        invalidateTriviaCardCache();
        return reply.code(201).send({
          id: created.id,
          index: deriveCardIndex(created.id),
          clue: created.clue,
          targets: created.targets.map(shapeEmployee),
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(409).send({ error: 'duplicate_id' });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/trivia/:id',
    {
      schema: {
        tags: ['Admin'],
        params: idParam,
        body: triviaBodySchema,
      },
    },
    async (req, reply) => {
      const body = req.body as { index?: number; clue?: string; targetIds?: string[] };
      // body.index is accepted for back-compat but ignored (no DB column).
      try {
        const updated = await prisma.triviaCard.update({
          where: { id: req.params.id },
          data: {
            clue: body.clue,
            // `set` replaces the M2M target list wholesale.
            targets: body.targetIds
              ? { set: body.targetIds.map((id) => ({ id })) }
              : undefined,
          },
          include: { targets: true },
        });
        invalidateTriviaCardCache();
        return {
          id: updated.id,
          index: deriveCardIndex(updated.id),
          clue: updated.clue,
          targets: updated.targets.map(shapeEmployee),
        };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/trivia/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      try {
        // PlayerCardAssignment.cardId and TriviaStamp.cardId both have
        // ON DELETE CASCADE, so the orphan rows clean up automatically.
        // /missions/trivia/start treats a missing assignment as "re-pick".
        await prisma.triviaCard.delete({ where: { id: req.params.id } });
        invalidateTriviaCardCache();
        invalidate(COMPLETION_CACHE_KEY);
        return { ok: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  //
  // ─── Pairs ───────────────────────────────────────────────────────
  //
  app.get(
    '/admin/pairs',
    {
      schema: {
        tags: ['Admin'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'confirmed', 'all'] },
            kind: { type: 'string', enum: ['all', 'TRIVIA', 'TEAMMATE'] },
          },
        },
      },
    },
    async (req) => {
      const { status, kind } = req.query as { status?: string; kind?: string };
      const where: Prisma.PairWhereInput = {};
      // Status filter only applies to trivia pairs (teammate pairs have no
      // confirmation state). For 'pending' / 'confirmed' the relation filter
      // also implicitly restricts to TRIVIA — there's no TriviaPenalty for a
      // teammate pair.
      if (status === 'pending') where.triviaPenalty = { is: { targetConfirmed: false } };
      if (status === 'confirmed') where.triviaPenalty = { is: { targetConfirmed: true } };
      if (kind === 'TRIVIA' || kind === 'TEAMMATE') where.kind = kind;

      const pairs = await prisma.pair.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          triviaPenalty: { include: { penalty: { select: { id: true, text: true } } } },
        },
      });
      const ids = new Set<string>();
      for (const p of pairs) {
        ids.add(p.hunterId);
        ids.add(p.targetId);
      }
      const emps = await getEmployeesByIds([...ids]);
      const empMap = new Map(emps.map((e) => [e.id, e]));

      return {
        pairs: pairs.map((p) => {
          const hunter = empMap.get(p.hunterId);
          const target = empMap.get(p.targetId);
          const tp = p.triviaPenalty;
          return {
            id: p.id,
            kind: p.kind,
            createdAt: p.createdAt.toISOString(),
            penalty: tp?.penalty ? { id: tp.penalty.id, text: tp.penalty.text } : null,
            targetConfirmed: tp?.targetConfirmed ?? false,
            proofPhotoUrl: tp?.proofPhotoUrl ?? null,
            hunter: hunter ? shapeEmployee(hunter) : null,
            target: target ? shapeEmployee(target) : null,
          };
        }),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/admin/pairs/:id/force-clear',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Force-confirm a pair so the hunter is freed from the auto-redirect',
        params: idParam,
      },
    },
    async (req, reply) => {
      const pair = await prisma.pair.findUnique({
        where: { id: req.params.id },
        include: { triviaPenalty: true },
      });
      if (!pair) return reply.code(404).send({ error: 'not_found' });
      if (pair.triviaPenalty?.targetConfirmed) return { ok: true, alreadyConfirmed: true };
      // Force-clear is only meaningful for trivia pairs — teammate pairs
      // have no penalty round to clear. Bail loudly so a misrouted call
      // doesn't silently no-op.
      if (!pair.triviaPenalty) return reply.code(400).send({ error: 'no_penalty_round' });

      await prisma.triviaPenalty.update({
        where: { pairId: pair.id },
        data: { targetConfirmed: true },
      });

      // Same broadcast pattern as POST /penalty/:pairId/confirm so connected
      // clients on either side update without a refetch. proofPhotoUrl stays
      // null — the frontend treats this as "round closed without proof".
      const peopleEmps = await getEmployeesByIds([pair.hunterId, pair.targetId]);
      const hunterEmp = peopleEmps.find((e) => e.id === pair.hunterId);
      const targetEmp = peopleEmps.find((e) => e.id === pair.targetId);

      broadcast(pair.id, { type: 'penalty.update', targetConfirmed: true, proofPhotoUrl: null });
      broadcastToUser(pair.hunterId, {
        type: 'penalty.update',
        pairId: pair.id,
        role: 'hunter',
        targetConfirmed: true,
        proofPhotoUrl: null,
        counterpartId: targetEmp?.id ?? pair.targetId,
        counterpartName: targetEmp?.name ?? '',
      });
      broadcastToUser(pair.targetId, {
        type: 'penalty.update',
        pairId: pair.id,
        role: 'target',
        targetConfirmed: true,
        proofPhotoUrl: null,
        counterpartId: hunterEmp?.id ?? pair.hunterId,
        counterpartName: hunterEmp?.name ?? '',
      });

      return { ok: true };
    },
  );

  //
  // ─── Scans ───────────────────────────────────────────────────────
  //
  app.get(
    '/admin/scans',
    {
      schema: {
        tags: ['Admin'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            mode: { type: 'string', enum: ['all', 'TRIVIA', 'TEAMMATE'] },
            outcome: { type: 'string', enum: ['all', 'MATCH', 'MISMATCH'] },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { q, mode, outcome, limit, cursor } = req.query as {
        q?: string;
        mode?: string;
        outcome?: string;
        limit?: number;
        cursor?: string;
      };
      const where: Prisma.ScanWhereInput = {};
      if (mode === 'TRIVIA' || mode === 'TEAMMATE') where.mode = mode;
      if (outcome === 'MATCH' || outcome === 'MISMATCH') where.outcome = outcome;
      if (q) {
        where.OR = [
          { scannerId: { contains: q, mode: 'insensitive' } },
          { scannedId: { contains: q, mode: 'insensitive' } },
          { cardRef: { contains: q, mode: 'insensitive' } },
          { scanner: { name: { contains: q, mode: 'insensitive' } } },
          { target: { name: { contains: q, mode: 'insensitive' } } },
        ];
      }

      const take = Math.min(limit ?? 50, 500);
      const rows = await prisma.scan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          scanner: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
        },
      });

      const hasMore = rows.length > take;
      const slice = hasMore ? rows.slice(0, take) : rows;

      return {
        scans: slice.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          mode: s.mode,
          outcome: s.outcome,
          cardRef: s.cardRef,
          pairId: s.pairId,
          scanner: s.scanner,
          target: s.target,
        })),
        nextCursor: hasMore ? slice[slice.length - 1].id : null,
      };
    },
  );

  //
  // ─── Chat answers ────────────────────────────────────────────────
  //
  app.get(
    '/admin/chat-answers',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Paginated list of hunter-typed chat answers (TEAMMATE flow)',
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { q, limit, cursor } = req.query as { q?: string; limit?: number; cursor?: string };
      const where: Prisma.ChatAnswerWhereInput = {};
      if (q) {
        where.OR = [
          { answer: { contains: q, mode: 'insensitive' } },
          { answerer: { name: { contains: q, mode: 'insensitive' } } },
          { pair: {
              OR: [
                { target: { name: { contains: q, mode: 'insensitive' } } },
                { hunter: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
          },
        ];
      }
      const take = Math.min(limit ?? 50, 500);
      // Composite-PK cursor: encode/decode as `${pairId}|${answererId}` on
      // the wire so the cursor stays a single opaque string for the client.
      const decoded = cursor ? cursor.split('|') : null;
      const cursorKey =
        decoded && decoded.length === 2
          ? { pairId_answererId: { pairId: decoded[0], answererId: decoded[1] } }
          : null;
      const rows = await prisma.chatAnswer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(cursorKey ? { cursor: cursorKey, skip: 1 } : {}),
        include: {
          question: { select: { id: true, question: true } },
          answerer: { select: { id: true, name: true } },
          pair: {
            select: {
              hunterId: true,
              targetId: true,
              hunter: { select: { id: true, name: true } },
              target: { select: { id: true, name: true } },
            },
          },
        },
      });
      const hasMore = rows.length > take;
      const slice = hasMore ? rows.slice(0, take) : rows;
      return {
        answers: slice.map((a) => {
          // The "counterpart" of an answer is the OTHER side of the pair —
          // whoever the answerer is talking about. With composite-PK answers
          // that's no longer always the pair's stored target.
          const counterpart =
            a.answererId === a.pair.hunterId ? a.pair.target : a.pair.hunter;
          return {
            pairId: a.pairId,
            createdAt: a.createdAt.toISOString(),
            question: a.question.question,
            answer: a.answer,
            answerer: a.answerer,
            target: counterpart,
          };
        }),
        nextCursor: hasMore
          ? `${slice[slice.length - 1].pairId}|${slice[slice.length - 1].answererId}`
          : null,
      };
    },
  );

  //
  // ─── Chat questions (CRUD) ───────────────────────────────────────
  //
  // `index` is the stable ordinal `pickQuestionForPair` hashes against.
  // We never let admins edit it: changing the index would re-route any
  // in-flight pair (one whose hunter hasn't submitted yet) to a different
  // question on next reload. Adds auto-pick `max(index)+1`. Deletes are
  // refused when answers reference the row, since `ChatAnswer.questionId`
  // has no ON DELETE CASCADE.
  const chatQuestionBodySchema = {
    type: 'object',
    properties: { question: { type: 'string', minLength: 1, maxLength: 500 } },
    required: ['question'],
  } as const;

  app.post(
    '/admin/chat-questions',
    { schema: { tags: ['Admin'], body: chatQuestionBodySchema } },
    async (req, reply) => {
      const { question } = req.body as { question: string };
      const last = await prisma.chatQuestion.findFirst({
        orderBy: { index: 'desc' },
        select: { index: true },
      });
      const nextIndex = (last?.index ?? -1) + 1;
      const created = await prisma.chatQuestion.create({
        data: { index: nextIndex, question },
        select: { id: true, index: true, question: true },
      });
      invalidateChatQuestionCache();
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/chat-questions/:id',
    { schema: { tags: ['Admin'], params: idParam, body: chatQuestionBodySchema } },
    async (req, reply) => {
      const { question } = req.body as { question: string };
      try {
        const updated = await prisma.chatQuestion.update({
          where: { id: req.params.id },
          data: { question },
          select: { id: true, index: true, question: true },
        });
        invalidateChatQuestionCache();
        return updated;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/chat-questions/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      const total = await prisma.chatQuestion.count();
      if (total <= 1) {
        return reply.code(409).send({ error: 'last_question' });
      }
      const answerCount = await prisma.chatAnswer.count({
        where: { questionId: req.params.id },
      });
      if (answerCount > 0) {
        return reply.code(409).send({ error: 'has_answers', answerCount });
      }
      try {
        await prisma.chatQuestion.delete({ where: { id: req.params.id } });
        invalidateChatQuestionCache();
        return { ok: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  app.get(
    '/admin/chat-answers/by-question',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Chat answers grouped by question (small pool, no pagination)',
      },
    },
    async () => {
      // The chat-question pool is small (~10–20 rows) and total answers is
      // bounded by ~(employees * teammate-confirms) ≈ low hundreds, so
      // fetching everything in one shot is fine. Skip pagination here.
      const questions = await prisma.chatQuestion.findMany({
        orderBy: { index: 'asc' },
        include: {
          answers: {
            orderBy: { createdAt: 'desc' },
            include: {
              answerer: { select: { id: true, name: true } },
              pair: {
                select: {
                  hunterId: true,
                  hunter: { select: { id: true, name: true } },
                  target: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });
      return {
        questions: questions.map((q) => ({
          id: q.id,
          question: q.question,
          answerCount: q.answers.length,
          answers: q.answers.map((a) => {
            // Counterpart = the other side of the pair from the answerer.
            const counterpart =
              a.answererId === a.pair.hunterId ? a.pair.target : a.pair.hunter;
            return {
              pairId: a.pairId,
              answererId: a.answererId,
              createdAt: a.createdAt.toISOString(),
              answer: a.answer,
              answerer: a.answerer,
              target: counterpart,
            };
          }),
        })),
      };
    },
  );

  //
  // ─── Memories ────────────────────────────────────────────────────
  //
  app.get(
    '/admin/memories',
    {
      schema: {
        tags: ['Admin'],
        querystring: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['all', 'memory', 'penalty'] },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (req) => {
      const { kind, limit } = req.query as { kind?: string; limit?: number };
      const where: Prisma.MemoryPhotoWhereInput = {};
      if (kind === 'penalty') where.contextKind = 'PENALTY';
      if (kind === 'memory') where.NOT = { contextKind: 'PENALTY' };

      const rows = await prisma.memoryPhoto.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit ?? 100, 500),
        include: {
          uploader: { select: { id: true, name: true } },
        },
      });

      // counterpart is a free-form id (FK, not a relation), look up via cache.
      const counterpartIds = [...new Set(rows.map((r) => r.counterpartId))];
      const counterEmps = await getEmployeesByIds(counterpartIds);
      const counterMap = new Map(counterEmps.map((e) => [e.id, e]));

      return {
        memories: rows.map((m) => ({
          id: m.id,
          url: m.url,
          // Admin UI compares against lowercase ('penalty'); keep the wire
          // shape stable even though the column is now an enum.
          contextKind: m.contextKind.toLowerCase(),
          contextId: m.contextId,
          createdAt: m.createdAt.toISOString(),
          uploader: m.uploader,
          counterpart: counterMap.get(m.counterpartId)
            ? { id: m.counterpartId, name: counterMap.get(m.counterpartId)!.name }
            : { id: m.counterpartId, name: '(deleted)' },
        })),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/memories/:id',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Delete a memory photo from Cloudinary + DB',
        params: idParam,
      },
    },
    async (req, reply) => {
      const row = await prisma.memoryPhoto.findUnique({ where: { id: req.params.id } });
      if (!row) return reply.code(404).send({ error: 'not_found' });

      // Best-effort destroy on Cloudinary; never block the row delete on a
      // remote failure since the row is the source of truth for the wall.
      try {
        await destroyImage(row.url);
      } catch (err) {
        req.log.warn({ err, url: row.url }, 'cloudinary destroy failed');
      }

      await prisma.memoryPhoto.delete({ where: { id: row.id } });
      invalidate(MEMORIES_WALL_CACHE);
      return { ok: true };
    },
  );

  //
  // ─── Penalties ───────────────────────────────────────────────────
  //
  app.get(
    '/admin/penalties',
    { schema: { tags: ['Admin'], summary: 'List penalty texts' } },
    async () => {
      const rows = await prisma.penalty.findMany({
        orderBy: { id: 'asc' },
        include: { _count: { select: { triviaPenalties: true } } },
      });
      return {
        penalties: rows.map((p) => ({
          id: p.id,
          text: p.text,
          usedCount: p._count.triviaPenalties,
        })),
      };
    },
  );

  const penaltyBodySchema = {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 500 } },
    required: ['text'],
  } as const;

  app.post(
    '/admin/penalties',
    { schema: { tags: ['Admin'], body: penaltyBodySchema } },
    async (req, reply) => {
      const { text } = req.body as { text: string };
      // Auto-generate a short hex id so admins don't have to invent one.
      // Loop until insert succeeds in the (astronomically rare) collision case.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = `penalty-${randomBytes(4).toString('hex')}`;
        try {
          const created = await prisma.penalty.create({ data: { id, text } });
          invalidatePenaltyCache();
          return reply.code(201).send({ id: created.id, text: created.text, usedCount: 0 });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
      return reply.code(500).send({ error: 'id_collision' });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/penalties/:id',
    {
      schema: {
        tags: ['Admin'],
        params: idParam,
        body: penaltyBodySchema,
      },
    },
    async (req, reply) => {
      const { text } = req.body as { text: string };
      try {
        const updated = await prisma.penalty.update({
          where: { id: req.params.id },
          data: { text },
          include: { _count: { select: { triviaPenalties: true } } },
        });
        invalidatePenaltyCache();
        return {
          id: updated.id,
          text: updated.text,
          usedCount: updated._count.triviaPenalties,
        };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/penalties/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      try {
        // FK on TriviaPenalty.penaltyId is ON DELETE SET NULL — in-flight
        // rounds keep their pair but lose their penalty text (frontend already
        // tolerates penalty=null on /penalty/:pairId).
        await prisma.penalty.delete({ where: { id: req.params.id } });
        invalidatePenaltyCache();
        return { ok: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  //
  // ─── Photo places ────────────────────────────────────────────────
  //
  app.get(
    '/admin/photo-places',
    { schema: { tags: ['Admin'], summary: 'List photo-spot suggestions' } },
    async () => {
      const rows = await prisma.photoPlace.findMany({ orderBy: { id: 'asc' } });
      return { places: rows.map((r) => ({ id: r.id, text: r.text })) };
    },
  );

  const photoPlaceBodySchema = {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 500 } },
    required: ['text'],
  } as const;

  app.post(
    '/admin/photo-places',
    { schema: { tags: ['Admin'], body: photoPlaceBodySchema } },
    async (req, reply) => {
      const { text } = req.body as { text: string };
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = `place-${randomBytes(4).toString('hex')}`;
        try {
          const created = await prisma.photoPlace.create({ data: { id, text } });
          invalidatePhotoPlaceCache();
          return reply.code(201).send({ id: created.id, text: created.text });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            continue;
          }
          throw err;
        }
      }
      return reply.code(500).send({ error: 'id_collision' });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/admin/photo-places/:id',
    { schema: { tags: ['Admin'], params: idParam, body: photoPlaceBodySchema } },
    async (req, reply) => {
      const { text } = req.body as { text: string };
      try {
        const updated = await prisma.photoPlace.update({
          where: { id: req.params.id },
          data: { text },
        });
        invalidatePhotoPlaceCache();
        return { id: updated.id, text: updated.text };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/admin/photo-places/:id',
    { schema: { tags: ['Admin'], params: idParam } },
    async (req, reply) => {
      try {
        // No FK references PhotoPlace.id — safe to hard-delete. Empty pool is
        // also fine: SuccessPage falls back to its i18n list when the API
        // returns nothing.
        await prisma.photoPlace.delete({ where: { id: req.params.id } });
        invalidatePhotoPlaceCache();
        return { ok: true };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.code(404).send({ error: 'not_found' });
        }
        throw err;
      }
    },
  );

  //
  // ─── Game lifecycle ──────────────────────────────────────────────
  //
  app.get(
    '/admin/game',
    { schema: { tags: ['Admin'], summary: 'Current game-clock state' } },
    async () => ({
      gameEndAt: gameEndAt().toISOString(),
      serverNow: new Date().toISOString(),
      isEnded: isGameEnded(),
    }),
  );

  app.post(
    '/admin/game/end-now',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Broadcast game.ended to every connected user (admin gate of finalize-all)',
        response: { 200: { type: 'object', additionalProperties: true }, 409: errorSchema },
      },
    },
    async (_req, reply) => {
      if (!isGameEnded()) {
        return reply.code(409).send({ error: 'not_yet_ended' });
      }
      const endedAt = gameEndAt().toISOString();
      broadcastGameEnded({ type: 'game.ended', endedAt });
      return { endedAt };
    },
  );

  //
  // ─── Redistribute leaders ────────────────────────────────────────
  //
  // Re-runs the seed's even-distribution pass with a randomized player
  // order — same greedy "leader with fewest assignments wins, tiebreak by
  // id" algorithm as `scripts/seed.ts`, but the player order is shuffled
  // first so admins can reroll for variety. Counts per leader stay even
  // (each leader gets ~totalPlayers/numLeaders assignments).
  app.post(
    '/admin/redistribute-leaders',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Reshuffle assignedLeaderId across all players (even-distribution)',
        response: { 200: { type: 'object', additionalProperties: true }, 409: errorSchema },
      },
    },
    async (_req, reply) => {
      const leaderRows = await prisma.employee.findMany({
        where: { isLeader: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (leaderRows.length === 0) {
        return reply.code(409).send({ error: 'no_leaders' });
      }
      const leaderIds = leaderRows.map((l) => l.id);

      const players = await prisma.employee.findMany({ select: { id: true } });
      // Fisher–Yates shuffle in place so the greedy pass produces a different
      // mapping each call (same counts, different per-player assignment).
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = players[i]!;
        players[i] = players[j]!;
        players[j] = tmp;
      }

      const counts: Record<string, number> = Object.fromEntries(
        leaderIds.map((id) => [id, 0]),
      );
      const distribution: Record<string, string> = {};
      for (const p of players) {
        const eligible = leaderIds.filter((id) => id !== p.id);
        if (eligible.length === 0) continue;
        eligible.sort((a, b) => counts[a]! - counts[b]! || a.localeCompare(b));
        const chosen = eligible[0]!;
        counts[chosen]++;
        distribution[p.id] = chosen;
      }

      // PlayerProgress may not exist yet for every player — upsert each. We
      // wrap in a single transaction so partial writes don't leave the
      // distribution half-applied if one upsert fails.
      await prisma.$transaction(
        Object.entries(distribution).map(([playerId, leaderId]) =>
          prisma.playerProgress.upsert({
            where: { playerId },
            create: { playerId, assignedLeaderId: leaderId },
            update: { assignedLeaderId: leaderId },
          }),
        ),
      );

      invalidate(COMPLETION_CACHE_KEY);

      return {
        ok: true,
        totalPlayers: Object.keys(distribution).length,
        leaderCount: leaderIds.length,
        counts,
      };
    },
  );

  //
  // ─── Wipe (destructive) ──────────────────────────────────────────
  //
  // Three destruction levels. All require body { confirm: 'WIPE' } as a
  // last-line defense against fat-fingered admin button clicks. Cloudinary
  // assets for wiped MemoryPhoto rows are best-effort destroyed in parallel
  // — failures are logged, never throw (the DB row is the source of truth
  // for the wall, and Cloudinary unused assets aren't billed by view).
  const wipeBodySchema = {
    type: 'object',
    properties: { confirm: { type: 'string', const: 'WIPE' } },
    required: ['confirm'],
  } as const;

  async function destroyMemoryPhotosInCloudinary(
    urls: string[],
  ): Promise<{ destroyed: number; failed: number }> {
    const results = await Promise.allSettled(urls.map((u) => destroyImage(u)));
    let destroyed = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') destroyed += 1;
      else failed += 1;
    }
    return { destroyed, failed };
  }

  app.post(
    '/admin/wipe/gameplay',
    {
      schema: {
        tags: ['Admin'],
        summary:
          'Wipe gameplay data + per-player assignments (cards + leaders re-shuffle on next start) — keep employees and content tables intact',
        body: wipeBodySchema,
      },
    },
    async (req, reply) => {
      const { confirm } = req.body as { confirm: string };
      if (confirm !== 'WIPE') {
        return reply.code(400).send({ error: 'confirmation_required' });
      }
      const photos = await prisma.memoryPhoto.findMany({ select: { url: true } });

      const counts = await prisma.$transaction(async (tx) => {
        const scans = await tx.scan.deleteMany({});
        const pairs = await tx.pair.deleteMany({});
        const stamps = await tx.triviaStamp.deleteMany({});
        const slots = await tx.teammateSlot.deleteMany({});
        const memories = await tx.memoryPhoto.deleteMany({});
        const cards = await tx.playerCardAssignment.deleteMany({});
        const progressReset = await tx.playerProgress.updateMany({
          data: { completedAt: null, assignedLeaderId: null },
        });
        return {
          scans: scans.count,
          pairs: pairs.count,
          triviaStamps: stamps.count,
          teammateSlots: slots.count,
          memoryPhotos: memories.count,
          cardAssignments: cards.count,
          progressReset: progressReset.count,
        };
      });

      invalidate(COMPLETION_CACHE_KEY);
      invalidate(MEMORIES_WALL_CACHE);

      const cloudinary = await destroyMemoryPhotosInCloudinary(
        photos.map((p) => p.url),
      );
      if (cloudinary.failed > 0) {
        req.log.warn({ failed: cloudinary.failed }, 'cloudinary destroy partial failures');
      }

      return { ok: true, level: 'gameplay', counts, cloudinary };
    },
  );

  app.post(
    '/admin/wipe/employees',
    {
      schema: {
        tags: ['Admin'],
        summary:
          'Wipe employees + everything that references them (gameplay, progress, cards-per-player) — but keep TriviaCard, ChatQuestion, Penalty, PhotoPlace content intact.',
        body: wipeBodySchema,
      },
    },
    async (req, reply) => {
      const { confirm } = req.body as { confirm: string };
      if (confirm !== 'WIPE') {
        return reply.code(400).send({ error: 'confirmation_required' });
      }
      const photos = await prisma.memoryPhoto.findMany({ select: { url: true } });

      const counts = await prisma.$transaction(async (tx) => {
        // Order matches wipe/all up through the Employee row; content tables
        // (ChatQuestion, Penalty, PhotoPlace, TriviaCard) are deliberately
        // preserved. Deleting Employee also clears the implicit
        // _TriviaCardTargets join rows — the TriviaCard rows themselves stay
        // but lose all their target links until the roster is re-seeded.
        const scans = await tx.scan.deleteMany({});
        const pairs = await tx.pair.deleteMany({}); // cascades TriviaPenalty + ChatAnswer
        const stamps = await tx.triviaStamp.deleteMany({});
        const slots = await tx.teammateSlot.deleteMany({});
        const cards = await tx.playerCardAssignment.deleteMany({});
        const memories = await tx.memoryPhoto.deleteMany({});
        const progress = await tx.playerProgress.deleteMany({});
        const employees = await tx.employee.deleteMany({});
        return {
          scans: scans.count,
          pairs: pairs.count,
          triviaStamps: stamps.count,
          teammateSlots: slots.count,
          cardAssignments: cards.count,
          memoryPhotos: memories.count,
          playerProgress: progress.count,
          employees: employees.count,
        };
      });

      invalidate(COMPLETION_CACHE_KEY);
      invalidate(MEMORIES_WALL_CACHE);
      invalidateEmployeeCache();
      // TriviaCard rows survive but their cached `targets` arrays are now
      // stale (every target Employee just got deleted) — drop the cache so
      // the next read re-hydrates with empty target lists.
      invalidateTriviaCardCache();

      const cloudinary = await destroyMemoryPhotosInCloudinary(
        photos.map((p) => p.url),
      );
      if (cloudinary.failed > 0) {
        req.log.warn({ failed: cloudinary.failed }, 'cloudinary destroy partial failures');
      }

      // Same reasoning as wipe/all: every active session's Employee row is
      // gone, so the next /me call will 401. Broadcast game.ended so any
      // open tab gets pushed to /time-up instead of seeing a blank screen.
      broadcastGameEnded({ type: 'game.ended', endedAt: new Date().toISOString() });

      return { ok: true, level: 'employees', counts, cloudinary };
    },
  );

  app.post(
    '/admin/wipe/all',
    {
      schema: {
        tags: ['Admin'],
        summary:
          'Full DB wipe — employees, cards, content, gameplay. Re-seed via npm run seed (or admin UI for content tables) before next event.',
        body: wipeBodySchema,
      },
    },
    async (req, reply) => {
      const { confirm } = req.body as { confirm: string };
      if (confirm !== 'WIPE') {
        return reply.code(400).send({ error: 'confirmation_required' });
      }
      const photos = await prisma.memoryPhoto.findMany({ select: { url: true } });

      const counts = await prisma.$transaction(async (tx) => {
        // Order matters: rows that hold non-cascade FKs to Employee/TriviaCard
        // must go first. PlayerProgress + its cascades go via the Employee
        // delete (PlayerProgress.playerId is Cascade), but we delete progress
        // first explicitly so the count comes back accurate.
        const scans = await tx.scan.deleteMany({});
        const pairs = await tx.pair.deleteMany({}); // cascades TriviaPenalty + ChatAnswer
        const stamps = await tx.triviaStamp.deleteMany({});
        const slots = await tx.teammateSlot.deleteMany({});
        const cards = await tx.playerCardAssignment.deleteMany({});
        const memories = await tx.memoryPhoto.deleteMany({});
        const progress = await tx.playerProgress.deleteMany({});
        // Content tables — admin can re-add through the UI after a wipe.
        const chatQuestions = await tx.chatQuestion.deleteMany({});
        const penalties = await tx.penalty.deleteMany({});
        const photoPlaces = await tx.photoPlace.deleteMany({});
        // Setup tables. TriviaCard delete also clears the implicit
        // _TriviaCardTargets join rows.
        const triviaCards = await tx.triviaCard.deleteMany({});
        const employees = await tx.employee.deleteMany({});
        return {
          scans: scans.count,
          pairs: pairs.count,
          triviaStamps: stamps.count,
          teammateSlots: slots.count,
          cardAssignments: cards.count,
          memoryPhotos: memories.count,
          playerProgress: progress.count,
          chatQuestions: chatQuestions.count,
          penalties: penalties.count,
          photoPlaces: photoPlaces.count,
          triviaCards: triviaCards.count,
          employees: employees.count,
        };
      });

      // Invalidate every cache the rest of the codebase relies on.
      invalidate(COMPLETION_CACHE_KEY);
      invalidate(MEMORIES_WALL_CACHE);
      invalidateEmployeeCache();
      invalidateTriviaCardCache();
      invalidateChatQuestionCache();
      invalidatePenaltyCache();
      invalidatePhotoPlaceCache();

      const cloudinary = await destroyMemoryPhotosInCloudinary(
        photos.map((p) => p.url),
      );
      if (cloudinary.failed > 0) {
        req.log.warn({ failed: cloudinary.failed }, 'cloudinary destroy partial failures');
      }

      // Tell every connected user the game is over — their session profile
      // points at an Employee that no longer exists, so subsequent /me calls
      // will 401 and bounce them to the welcome page anyway.
      broadcastGameEnded({ type: 'game.ended', endedAt: new Date().toISOString() });

      return { ok: true, level: 'all', counts, cloudinary };
    },
  );
}
