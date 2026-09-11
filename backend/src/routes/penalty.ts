import type { FastifyInstance } from 'fastify';
import { MemoryContext } from '@prisma/client';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import { broadcast, broadcastToUser } from '@/ws/hub.js';
import { uploadImage } from '@/lib/cloudinary.js';
import { invalidate } from '@/lib/ttlCache.js';
import { getEmployeesByIds } from '@/lib/employeeCache.js';
import { pickRandomPenaltyId } from '@/lib/penaltyCache.js';
import { MEMORIES_WALL_CACHE } from './memories.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const pairIdParams = {
  type: 'object',
  properties: { pairId: { type: 'string' } },
  required: ['pairId'],
} as const;

const personRefSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
  nullable: true,
} as const;

export async function penaltyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { pairId: string } }>(
    '/penalty/:pairId/confirm',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Penalty'],
        summary: 'Target uploads a photo proof to confirm the penalty',
        description:
          'Only the scanned (target) side may confirm. Accepts multipart/form-data with a `photo` file. Uploads to Cloudinary, stores the URL on `TriviaPenalty.proofPhotoUrl`, sets `targetConfirmed=true`, and broadcasts `penalty.update` over the pair and user WS channels.',
        security: [{ sessionCookie: [] }],
        params: pairIdParams,
        consumes: ['multipart/form-data'],
        response: {
          200: {
            type: 'object',
            properties: { proofPhotoUrl: { type: 'string' } },
            required: ['proofPhotoUrl'],
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const pair = await prisma.pair.findUnique({ where: { id: req.params.pairId } });
      if (!pair) return reply.code(404).send({ error: 'not_found' });

      const sessionId = req.session.get('employeeId')!;
      if (pair.targetId !== sessionId) return reply.code(403).send({ error: 'not_target' });

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'missing_photo' });
      if (!file.mimetype.startsWith('image/')) {
        return reply.code(400).send({ error: 'not_an_image' });
      }
      const buf = await file.toBuffer();

      let proofPhotoUrl: string;
      try {
        proofPhotoUrl = await uploadImage(buf, 'penalty-proof');
      } catch (err) {
        req.log.error({ err }, 'cloudinary upload failed');
        return reply.code(500).send({ error: 'upload_failed' });
      }

      // Upsert: typically the row already exists (created by processScan
      // mismatch), but defensively support the create case in the (rare)
      // event the target somehow lands on the page without a penalty row —
      // they still need a penalty assigned to confirm against. Falls back to
      // a fresh random pick.
      await prisma.triviaPenalty.upsert({
        where: { pairId: pair.id },
        update: { targetConfirmed: true, proofPhotoUrl },
        create: {
          pairId: pair.id,
          penaltyId: await pickRandomPenaltyId(),
          targetConfirmed: true,
          proofPhotoUrl,
        },
      });

      await prisma.memoryPhoto.create({
        data: {
          url: proofPhotoUrl,
          uploaderId: sessionId,
          counterpartId: pair.hunterId,
          contextKind: MemoryContext.PENALTY,
          contextId: pair.id,
        },
      });
      invalidate(MEMORIES_WALL_CACHE);

      const peopleEmps = await getEmployeesByIds([pair.hunterId, pair.targetId]);
      const hunterEmp = peopleEmps.find((e) => e.id === pair.hunterId);
      const targetEmp = peopleEmps.find((e) => e.id === pair.targetId);

      broadcast(pair.id, {
        type: 'penalty.update',
        targetConfirmed: true,
        proofPhotoUrl,
      });

      broadcastToUser(pair.hunterId, {
        type: 'penalty.update',
        pairId: pair.id,
        role: 'hunter',
        targetConfirmed: true,
        proofPhotoUrl,
        counterpartId: targetEmp?.id ?? pair.targetId,
        counterpartName: targetEmp?.name ?? '',
      });
      broadcastToUser(pair.targetId, {
        type: 'penalty.update',
        pairId: pair.id,
        role: 'target',
        targetConfirmed: true,
        proofPhotoUrl,
        counterpartId: hunterEmp?.id ?? pair.hunterId,
        counterpartName: hunterEmp?.name ?? '',
      });

      return { proofPhotoUrl };
    },
  );

  app.get<{ Params: { pairId: string } }>(
    '/penalty/:pairId',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Penalty'],
        summary: 'Get the current confirmation state of a penalty pair',
        security: [{ sessionCookie: [] }],
        params: pairIdParams,
        response: {
          200: {
            type: 'object',
            properties: {
              targetConfirmed: { type: 'boolean' },
              proofPhotoUrl: { type: 'string', nullable: true },
              penalty: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['id', 'text'],
                nullable: true,
              },
              hunter: personRefSchema,
              target: personRefSchema,
            },
            required: ['targetConfirmed'],
          },
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const pair = await prisma.pair.findUnique({
        where: { id: req.params.pairId },
        include: {
          triviaPenalty: { include: { penalty: { select: { id: true, text: true } } } },
        },
      });
      if (!pair) return reply.code(404).send({ error: 'not_found' });
      const peopleEmps = await getEmployeesByIds([pair.hunterId, pair.targetId]);
      const hunterEmp = peopleEmps.find((e) => e.id === pair.hunterId);
      const targetEmp = peopleEmps.find((e) => e.id === pair.targetId);
      const tp = pair.triviaPenalty;
      return {
        targetConfirmed: tp?.targetConfirmed ?? false,
        proofPhotoUrl: tp?.proofPhotoUrl ?? null,
        penalty: tp?.penalty ? { id: tp.penalty.id, text: tp.penalty.text } : null,
        hunter: hunterEmp ? { id: hunterEmp.id, name: hunterEmp.name } : null,
        target: targetEmp ? { id: targetEmp.id, name: targetEmp.name } : null,
      };
    },
  );
}
