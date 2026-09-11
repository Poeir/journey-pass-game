import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import { getEmployee } from '@/lib/employeeCache.js';
import { getAllTriviaCardsOrdered, getTriviaCardsByIds } from '@/lib/triviaCardCache.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const triviaCardSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    index: { type: 'integer' },
    prompt: { type: 'string' },
    answer: { type: 'string' },
  },
  additionalProperties: true,
} as const;

export async function missionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/missions/trivia/start',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Missions'],
        summary: 'Start a trivia mission (returns shuffled cards)',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              cards: { type: 'array', items: triviaCardSchema },
            },
            required: ['cards'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const employeeId = req.session.get('employeeId')!;
      const TRIVIA_CARDS_PER_PLAYER = 5;

      // Strip targetIds before returning — this endpoint is public-facing card
      // metadata; the targets list is solver-side only and lives in the cache.
      const stripCard = (c: { id: string; index: number; clue: string }) => ({
        id: c.id,
        index: c.index,
        clue: c.clue,
      });

      const existing = await prisma.playerCardAssignment.findMany({
        where: { playerId: employeeId },
        orderBy: { position: 'asc' },
        select: { cardId: true },
      });

      if (existing.length === TRIVIA_CARDS_PER_PLAYER) {
        const assignedIds = existing.map((a) => a.cardId);
        const found = await getTriviaCardsByIds(assignedIds);
        if (found.length === assignedIds.length) {
          const byCardId = new Map(found.map((c) => [c.id, c]));
          const ordered = assignedIds
            .map((id) => byCardId.get(id))
            .filter((c): c is (typeof found)[number] => c !== undefined)
            .map(stripCard);
          return { cards: ordered };
        }
        // Cache lag: assignment count is right but the cache hasn't seen a
        // referenced card yet. Fall through to re-pick — the next
        // invalidate-tick will sync everything.
      }
      // existing.length < TRIVIA_CARDS_PER_PLAYER means a referenced card
      // was admin-deleted (CASCADE shrank the assignment), or the player
      // hasn't been picked yet. Either way, re-pick fresh — orphan stamp
      // rows on cards no longer in the new pick are tolerated by
      // selectIsComplete (which only counts toward the 5 assigned cards).
      // existing.length > TRIVIA_CARDS_PER_PLAYER shouldn't happen, but
      // re-picking is the safe normalization.

      // Snapshot from cache is shared/frozen — copy before shuffling.
      const all = (await getAllTriviaCardsOrdered()).slice();
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      const picked = all.slice(0, TRIVIA_CARDS_PER_PLAYER);

      await prisma.$transaction(async (tx) => {
        await tx.playerProgress.upsert({
          where: { playerId: employeeId },
          create: { playerId: employeeId },
          update: {},
        });
        // Replace any pre-existing partial assignment in one shot — cheaper
        // than reconciling per-row and matches the previous JSON overwrite.
        await tx.playerCardAssignment.deleteMany({ where: { playerId: employeeId } });
        await tx.playerCardAssignment.createMany({
          data: picked.map((c, i) => ({ playerId: employeeId, cardId: c.id, position: i })),
        });
      });

      return { cards: picked.map(stripCard) };
    },
  );

  app.get(
    '/missions/teammate/start',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Missions'],
        summary: 'Start a teammate mission (returns the user year + leader clue)',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              year: { type: 'integer' },
              leaderClue: { type: ['string', 'null'] },
            },
            required: ['year', 'leaderClue'],
          },
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const employeeId = req.session.get('employeeId')!;
      const emp = await getEmployee(employeeId);
      if (!emp) return reply.code(404).send({ error: 'not_found' });
      const progress = await prisma.playerProgress.findUnique({ where: { playerId: employeeId } });
      let leaderClue: string | null = null;
      if (progress?.assignedLeaderId) {
        const leader = await getEmployee(progress.assignedLeaderId);
        leaderClue = leader?.leaderClue ?? null;
      }
      return { year: emp.year, leaderClue };
    },
  );
}
