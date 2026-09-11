import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import { gameEndAt, isGameEnded } from '@/lib/gameClock.js';
import { broadcastGameEnded } from '@/ws/hub.js';
import { invalidate, ttlCached } from '@/lib/ttlCache.js';

const RANKING_CACHE_KEY = 'completion:ranking';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

export async function completionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/completion',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Completion'],
        summary: 'Mark the current player as completed',
        description: 'Idempotent: returns `alreadyCompleted: true` if the player has already finished.',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              completedAt: { type: 'string', format: 'date-time' },
              alreadyCompleted: { type: 'boolean' },
            },
            required: ['completedAt', 'alreadyCompleted'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const playerId = req.session.get('employeeId')!;
      const existing = await prisma.playerProgress.findUnique({ where: { playerId } });

      if (existing?.completedAt) {
        return { completedAt: existing.completedAt.toISOString(), alreadyCompleted: true };
      }

      const progress = await prisma.playerProgress.upsert({
        where: { playerId },
        create: { playerId, completedAt: new Date() },
        update: { completedAt: new Date() },
      });
      invalidate(RANKING_CACHE_KEY);
      return { completedAt: progress.completedAt!.toISOString(), alreadyCompleted: false };
    },
  );

  app.get(
    '/completion/list',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Completion'],
        summary: 'List all completed players (admin-ish; gating TODO)',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              completions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
            required: ['completions'],
          },
          401: errorSchema,
        },
      },
    },
    async () => {
      // TODO: gate with admin role check when role model is added.
      const rows = await prisma.playerProgress.findMany({
        where: { completedAt: { not: null } },
        include: { player: true },
        orderBy: { completedAt: 'asc' },
      });
      return { completions: rows };
    },
  );

  app.get(
    '/completion/ranking',
    {
      schema: {
        tags: ['Completion'],
        summary: 'Public ranking feed',
        description:
          'Returns every employee split into `done` (with `completedAt`, ordered ascending — first finisher first) and `pending` (no `completedAt` yet). No authentication required — designed for projector display during the event.',
        response: {
          200: {
            type: 'object',
            properties: {
              done: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    dept: { type: 'string' },
                    completedAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: ['string', 'null'], format: 'date-time' },
                    done: { type: 'integer' },
                    total: { type: 'integer' },
                  },
                  required: ['id', 'name', 'dept', 'completedAt', 'updatedAt', 'done', 'total'],
                },
              },
              pending: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    dept: { type: 'string' },
                    updatedAt: { type: ['string', 'null'], format: 'date-time' },
                    done: { type: 'integer' },
                    total: { type: 'integer' },
                  },
                  required: ['id', 'name', 'dept', 'updatedAt', 'done', 'total'],
                },
              },
            },
            required: ['done', 'pending'],
          },
        },
      },
    },
    async (_req, reply) => {
      // Public projector endpoint — TTL cache (3s) absorbs in-app polling and
      // Cache-Control lets browsers/CDN reuse responses without hitting Fastify.
      reply.header('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
      return ttlCached(RANKING_CACHE_KEY, 3000, computeRanking);
    },
  );

  async function computeRanking() {
      // Completion mirrors the frontend's `selectIsComplete`: 5 trivia stamps +
      // 5 non-leader teammate members = 10. The leader slot is an "extra" / bonus
      // and does NOT count toward the quest total.
      const TRIVIA_TOTAL = 5;
      const TEAMMATE_TOTAL = 5;
      const QUEST_TOTAL = TRIVIA_TOTAL + TEAMMATE_TOTAL;

      // One round-trip: roster + each player's stamp + non-leader-slot counts.
      // `_count` does the aggregation in SQL, no in-memory walk over a JSON blob.
      const employees = await prisma.employee.findMany({
        select: {
          id: true,
          name: true,
          dept: true,
          progress: {
            select: {
              completedAt: true,
              updatedAt: true,
              _count: {
                select: {
                  triviaStamps: true,
                  // Counted via JOIN below — non-leader members only, since leaders
                  // are bonus and don't count toward completion.
                  teammateSlots: { where: { member: { isLeader: false } } },
                },
              },
            },
          },
        },
      });

      const computeDone = (counts: { triviaStamps: number; teammateSlots: number } | undefined): number => {
        if (!counts) return 0;
        return Math.min(TRIVIA_TOTAL, counts.triviaStamps) + Math.min(TEAMMATE_TOTAL, counts.teammateSlots);
      };

      const done = employees
        .filter((e) => e.progress?.completedAt)
        .map((e) => ({
          id: e.id,
          name: e.name,
          dept: e.dept,
          completedAt: e.progress!.completedAt!.toISOString(),
          updatedAt: e.progress?.updatedAt?.toISOString() ?? null,
          done: computeDone(e.progress?._count),
          total: QUEST_TOTAL,
        }))
        .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

      const pending = employees
        .filter((e) => !e.progress?.completedAt)
        .map((e) => ({
          id: e.id,
          name: e.name,
          dept: e.dept,
          updatedAt: e.progress?.updatedAt?.toISOString() ?? null,
          done: computeDone(e.progress?._count),
          total: QUEST_TOTAL,
        }))
        .sort((a, b) => {
          // Players who have actually started (done > 0) float to the top,
          // ordered by progress then recent activity. Players with no progress
          // yet stay at the bottom in alphabetical order — so the projector
          // shows a stable A-Z roster at the start of the event and lights up
          // top-down as people complete their first quest.
          const aActive = a.done > 0;
          const bActive = b.done > 0;
          if (aActive !== bActive) return aActive ? -1 : 1;
          if (aActive) {
            if (b.done !== a.done) return b.done - a.done;
            const aUpd = a.updatedAt ?? '';
            const bUpd = b.updatedAt ?? '';
            if (bUpd !== aUpd) return bUpd.localeCompare(aUpd);
          }
          return a.name.localeCompare(b.name);
        });

      return { done, pending };
  }

  app.post(
    '/completion/finalize-all',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Completion'],
        summary: 'Broadcast game-end to all connected players (admin-ish; gating TODO)',
        description:
          'Broadcasts `game.ended` on every user WS channel so connected clients redirect to the time-up screen. Does NOT mutate `completedAt` — that field strictly means "the player actually finished all quests". Players who run out of time keep `completedAt = null`.',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              endedAt: { type: 'string', format: 'date-time' },
            },
            required: ['endedAt'],
          },
          401: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (_req, reply) => {
      // TODO: gate with admin role check when role model is added.
      if (!isGameEnded()) {
        return reply.code(409).send({ error: 'not_yet_ended' });
      }
      const endedAt = gameEndAt().toISOString();
      broadcastGameEnded({ type: 'game.ended', endedAt });
      return { endedAt };
    },
  );
}
