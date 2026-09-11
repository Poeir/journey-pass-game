import type { FastifyInstance } from 'fastify';
import { MemoryContext } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import { uploadImage } from '@/lib/cloudinary.js';
import { invalidate, ttlCached } from '@/lib/ttlCache.js';
import { getEmployee, getEmployeesByIds } from '@/lib/employeeCache.js';
import { toEmployeeShape } from '@/domain/scan.js';
import { broadcastToUser } from '@/ws/hub.js';

const MEMORIES_WALL_CACHE_KEY = 'memories:wall';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

// Wire-format context kinds accepted from the frontend uploader.
// `penalty` is written by routes/penalty.ts directly, never through this route.
const CONTEXT_KIND_MAP: Record<string, MemoryContext> = {
  trivia: MemoryContext.TRIVIA,
  teammate: MemoryContext.TEAMMATE,
};

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/memories',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Memories'],
        summary: 'Upload a memory photo taken on a successful match/teammate',
        description:
          'Multipart upload. Fields: `photo` (image file), `contextKind` (`trivia` | `teammate`), `contextId` (cardId or pairId), `counterpartId` (the employee in the photo with the uploader). Stores the photo on Cloudinary and persists a `MemoryPhoto` row.',
        security: [{ sessionCookie: [] }],
        consumes: ['multipart/form-data'],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              createdAt: { type: 'string' },
            },
            required: ['id', 'url', 'createdAt'],
          },
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const sessionId = req.session.get('employeeId')!;

      const parts = req.parts();
      let photoBuf: Buffer | null = null;
      let photoMime = '';
      let contextKind = '';
      let contextId = '';
      let counterpartId = '';
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'photo') {
            photoMime = part.mimetype;
            photoBuf = await part.toBuffer();
          } else {
            await part.toBuffer();
          }
        } else {
          const value = typeof part.value === 'string' ? part.value : '';
          if (part.fieldname === 'contextKind') contextKind = value;
          else if (part.fieldname === 'contextId') contextId = value;
          else if (part.fieldname === 'counterpartId') counterpartId = value;
        }
      }

      if (!photoBuf) return reply.code(400).send({ error: 'missing_photo' });
      if (!photoMime.startsWith('image/')) return reply.code(400).send({ error: 'not_an_image' });
      const contextKindEnum = CONTEXT_KIND_MAP[contextKind];
      if (!contextKindEnum) return reply.code(400).send({ error: 'invalid_context_kind' });
      if (!contextId) return reply.code(400).send({ error: 'missing_context_id' });
      if (!counterpartId) return reply.code(400).send({ error: 'missing_counterpart_id' });

      const counterpart = await getEmployee(counterpartId);
      if (!counterpart) return reply.code(404).send({ error: 'counterpart_not_found' });

      let url: string;
      try {
        url = await uploadImage(photoBuf, 'memories');
      } catch (err) {
        req.log.error({ err }, 'cloudinary upload failed');
        return reply.code(500).send({ error: 'upload_failed' });
      }

      const memory = await prisma.memoryPhoto.create({
        data: {
          url,
          uploaderId: sessionId,
          counterpartId,
          contextKind: contextKindEnum,
          contextId,
        },
      });
      invalidate(MEMORIES_WALL_CACHE_KEY);

      // Teammate flow only: nudge the counterpart so their SuccessPage
      // flips from "waiting for {scanner} to capture" to the actual photo
      // without needing to poll. Trivia memories are scanner-only and
      // don't need a peer notification.
      if (contextKindEnum === MemoryContext.TEAMMATE) {
        const uploader = await getEmployee(sessionId);
        if (uploader) {
          broadcastToUser(counterpartId, {
            type: 'memory.captured',
            pairId: contextId,
            url: memory.url,
            uploaderId: sessionId,
            uploaderName: uploader.name,
          });
        }
      }

      return { id: memory.id, url: memory.url, createdAt: memory.createdAt.toISOString() };
    },
  );

  app.get<{ Params: { pairId: string } }>(
    '/memories/pair/:pairId',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Memories'],
        summary: 'Get the pair-level capture state for the SuccessPage',
        description:
          'Returns the caller\'s role on the teammate pair, the counterpart shape, and the shared memory photo (if anyone has captured it yet). The hunter side sees the upload affordance until they upload; the target side sees a "waiting for {scanner}" state until the photo lands. Both sides resolve to the same photo the moment the upload completes. Caller must be hunter or target on the pair.',
        security: [{ sessionCookie: [] }],
        params: {
          type: 'object',
          properties: { pairId: { type: 'string' } },
          required: ['pairId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['hunter', 'target'] },
              counterpart: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  initial: { type: 'string' },
                  dept: { type: 'string' },
                  year: { type: 'number' },
                  isLeader: { type: 'boolean' },
                },
                required: ['id', 'name', 'initial', 'dept', 'year', 'isLeader'],
              },
              photo: {
                anyOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      url: { type: 'string' },
                      uploaderId: { type: 'string' },
                      uploaderName: { type: 'string' },
                      createdAt: { type: 'string' },
                    },
                    required: ['id', 'url', 'uploaderId', 'uploaderName', 'createdAt'],
                  },
                ],
              },
            },
            required: ['role', 'counterpart', 'photo'],
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const sessionId = req.session.get('employeeId')!;
      const pair = await prisma.pair.findUnique({ where: { id: req.params.pairId } });
      if (!pair) return reply.code(404).send({ error: 'not_found' });
      if (pair.kind !== 'TEAMMATE') {
        return reply.code(400).send({ error: 'not_teammate_pair' });
      }
      if (sessionId !== pair.hunterId && sessionId !== pair.targetId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const role = sessionId === pair.hunterId ? 'hunter' : 'target';
      const otherId = role === 'hunter' ? pair.targetId : pair.hunterId;
      const [others, photo] = await Promise.all([
        getEmployeesByIds([otherId]),
        prisma.memoryPhoto.findFirst({
          where: {
            contextKind: MemoryContext.TEAMMATE,
            contextId: req.params.pairId,
          },
          // Earliest = first to upload "wins". The second arrival sees this
          // photo instead of being prompted to take a duplicate.
          orderBy: { createdAt: 'asc' },
          include: { uploader: { select: { id: true, name: true } } },
        }),
      ]);
      const other = others[0];
      if (!other) return reply.code(404).send({ error: 'counterpart_not_found' });
      return {
        role,
        counterpart: toEmployeeShape(other),
        photo: photo
          ? {
              id: photo.id,
              url: photo.url,
              uploaderId: photo.uploaderId,
              uploaderName: photo.uploader.name,
              createdAt: photo.createdAt.toISOString(),
            }
          : null,
      };
    },
  );

  app.get(
    '/memories/wall',
    {
      schema: {
        tags: ['Memories'],
        summary: 'Public memory wall feed',
        description:
          'Returns up to 200 most recent `MemoryPhoto` rows. `kind` is derived from `contextKind` — `penalty` for penalty proofs, `memory` for trivia/teammate captures. No authentication required — designed for projector display during the event.',
        response: {
          200: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    url: { type: 'string' },
                    kind: { type: 'string', enum: ['memory', 'penalty'] },
                    createdAt: { type: 'string' },
                  },
                  required: ['id', 'url', 'kind', 'createdAt'],
                },
              },
            },
            required: ['items'],
          },
        },
      },
    },
    async (_req, reply) => {
      // Public projector endpoint — cached 3s. Fresh uploads invalidate the
      // cache via `invalidate(MEMORIES_WALL_CACHE_KEY)` in POST /memories
      // and POST /penalty/:pairId/confirm.
      reply.header('Cache-Control', 'public, max-age=3, stale-while-revalidate=10');
      return ttlCached(MEMORIES_WALL_CACHE_KEY, 3000, async () => {
        const rows = await prisma.memoryPhoto.findMany({
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, url: true, contextKind: true, createdAt: true },
        });

        const items = rows.map((m) => ({
          id: m.id,
          url: m.url,
          kind: m.contextKind === MemoryContext.PENALTY ? ('penalty' as const) : ('memory' as const),
          createdAt: m.createdAt.toISOString(),
        }));

        return { items };
      });
    },
  );
}

export const MEMORIES_WALL_CACHE = MEMORIES_WALL_CACHE_KEY;
