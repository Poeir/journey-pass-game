import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@/middleware/auth.js';
import { processScan, NotFoundError, GameEndedError } from '@/domain/scan.js';

const ScanBody = z.object({
  scanner_id: z.string().min(1),
  scanned_id: z.string().min(1),
  card_ref: z.string().optional(),
});

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    issues: { type: 'array' },
    resource: { type: 'string' },
  },
  required: ['error'],
} as const;

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/scans',
    {
      preHandler: requireSession,
      // Each scan triggers a transaction with an advisory lock. Cap per-IP burst
      // so a single client can't pin the lock or saturate the connection pool.
      config: {
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Scans'],
        summary: 'Submit a QR scan and process it',
        description:
          'The `scanner_id` must equal the session user. Returns the resolved scan outcome (varies by mission/card).',
        security: [{ sessionCookie: [] }],
        body: {
          type: 'object',
          properties: {
            scanner_id: { type: 'string', minLength: 1 },
            scanned_id: { type: 'string', minLength: 1 },
            card_ref: { type: 'string' },
          },
          required: ['scanner_id', 'scanned_id'],
        },
        response: {
          200: {
            description: 'Scan processed (shape depends on scan kind).',
            type: 'object',
            additionalProperties: true,
          },
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const body = ScanBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });

      const sessionId = req.session.get('employeeId')!;
      if (body.data.scanner_id !== sessionId) {
        return reply.code(403).send({ error: 'scanner_mismatch' });
      }
      if (body.data.scanner_id === body.data.scanned_id) {
        return reply.code(400).send({ error: 'self_scan' });
      }

      try {
        const result = await processScan({
          scannerId: body.data.scanner_id,
          scannedId: body.data.scanned_id,
          cardRef: body.data.card_ref,
        });
        // Dead-end outcomes leave no audit row — log them so unusual flows are
        // still observable (user repeatedly hitting the wrong leader, leaders
        // scanning each other, etc).
        if (result.outcome === 'wrong_leader' || result.outcome === 'leader_clash') {
          req.log.warn(
            {
              outcome: result.outcome,
              scanner: sessionId,
              target: body.data.scanned_id,
            },
            'dead-end scan',
          );
        }
        return result;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return reply.code(404).send({ error: 'not_found', resource: err.resource });
        }
        if (err instanceof GameEndedError) {
          return reply.code(409).send({ error: 'game_ended' });
        }
        throw err;
      }
    },
  );
}
