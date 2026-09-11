import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import {
  addTeammateSlot,
  inSameYearGroup,
  toEmployeeShape,
  type EmployeeShape,
} from '@/domain/scan.js';
import { pickQuestionForPair } from '@/domain/chatQuestions.js';
import { getEmployeesByIds } from '@/lib/employeeCache.js';
import { broadcastToUser } from '@/ws/hub.js';

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

const employeeShapeSchema = {
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
} as const;

// Soft cap so a stuck client / paste accident can't blow up the row size.
const MAX_ANSWER_LEN = 2000;

// Decide whether `otherId` may be added to `callerId`'s roster, mirroring
// processScan's pre-checks for the reverse direction so the mutual-add flow
// silently skips on year/leader mismatches without flipping the caller's UI
// into an error state. Cap checks (already_added / leader_full / teammate_full)
// are handled inside addTeammateSlot itself, so we don't repeat them here.
async function passesMutualPrechecks(
  caller: EmployeeShape,
  other: EmployeeShape,
  callerAssignedLeaderId: string | null,
): Promise<boolean> {
  if (other.isLeader) {
    // Leader-vs-leader recruiting is forbidden in either direction.
    if (caller.isLeader) return false;
    // Wrong-leader: the caller has an assigned leader and `other` isn't them.
    if (callerAssignedLeaderId && callerAssignedLeaderId !== other.id) return false;
    return true;
  }
  // Both non-leader → bilateral year-group check.
  if (caller.isLeader) return false; // shouldn't happen — leaders aren't a normal scan target
  return inSameYearGroup(caller.year, other.year);
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { pairId: string } }>(
    '/chat/:pairId/question',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Chat'],
        summary: 'Get the chat question + counterpart for a teammate pair',
        description:
          'Returns the deterministic chat question for this pair (stable per pairId), the counterpart\'s employee shape, the caller\'s role on the pair, and whether each side has already submitted their answer. Caller must be the hunter or target on the pair.',
        security: [{ sessionCookie: [] }],
        params: pairIdParams,
        response: {
          200: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              role: { type: 'string', enum: ['hunter', 'target'] },
              counterpart: employeeShapeSchema,
              myAnswered: { type: 'boolean' },
              theirAnswered: { type: 'boolean' },
            },
            required: ['question', 'role', 'counterpart', 'myAnswered', 'theirAnswered'],
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
      if (pair.kind !== 'TEAMMATE') return reply.code(400).send({ error: 'not_teammate_pair' });

      const sessionId = req.session.get('employeeId')!;
      if (sessionId !== pair.hunterId && sessionId !== pair.targetId) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const role = sessionId === pair.hunterId ? 'hunter' : 'target';
      const otherId = role === 'hunter' ? pair.targetId : pair.hunterId;

      const [picked, employees, answers] = await Promise.all([
        pickQuestionForPair(pair.id),
        getEmployeesByIds([otherId]),
        prisma.chatAnswer.findMany({
          where: { pairId: pair.id },
          select: { answererId: true },
        }),
      ]);
      const other = employees.find((e) => e.id === otherId);
      if (!other) return reply.code(404).send({ error: 'not_found' });

      const answeredIds = new Set(answers.map((a) => a.answererId));
      return {
        question: picked.question,
        role,
        counterpart: toEmployeeShape(other),
        myAnswered: answeredIds.has(sessionId),
        theirAnswered: answeredIds.has(otherId),
      };
    },
  );

  app.post<{ Params: { pairId: string }; Body: { answer?: string } }>(
    '/chat/:pairId/confirm-teammate',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Chat'],
        summary: 'Confirm a teammate after the chat-question step',
        description:
          'Called by EITHER side of a teammate pair after submitting the chat-confirm answer. Persists the caller\'s answer (composite PK on ChatAnswer = pairId + answererId) and adds the counterpart to the caller\'s teammateSlots. Idempotent on re-confirm. Year-group / leader-clash / wrong-leader for the caller\'s perspective are checked here as a silent skip — the response still returns ok=true even if the slot wasn\'t added (e.g., target\'s year doesn\'t match scanner\'s, or the caller\'s roster is full).',
        security: [{ sessionCookie: [] }],
        params: pairIdParams,
        body: {
          type: 'object',
          properties: {
            answer: { type: 'string', minLength: 1, maxLength: MAX_ANSWER_LEN },
          },
          required: ['answer'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              bothAnswered: { type: 'boolean' },
              added: { type: 'boolean' },
              role: { type: 'string', enum: ['hunter', 'target'] },
              counterpart: employeeShapeSchema,
            },
            required: ['ok', 'bothAnswered', 'added', 'role', 'counterpart'],
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
      if (pair.kind !== 'TEAMMATE') return reply.code(400).send({ error: 'not_teammate_pair' });

      const sessionId = req.session.get('employeeId')!;
      if (sessionId !== pair.hunterId && sessionId !== pair.targetId) {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const answer = (req.body?.answer ?? '').trim();
      if (!answer) return reply.code(400).send({ error: 'missing_answer' });

      const role = sessionId === pair.hunterId ? 'hunter' : 'target';
      const otherId = role === 'hunter' ? pair.targetId : pair.hunterId;

      const [employees, picked] = await Promise.all([
        getEmployeesByIds([sessionId, otherId]),
        pickQuestionForPair(pair.id),
      ]);
      const caller = employees.find((e) => e.id === sessionId);
      const other = employees.find((e) => e.id === otherId);
      if (!caller || !other) return reply.code(404).send({ error: 'not_found' });

      const callerShape = toEmployeeShape(caller);
      const otherShape = toEmployeeShape(other);

      // Composite-PK upsert: each (pairId, answererId) is one row, so hunter
      // and target write distinct rows. Idempotent on re-confirm.
      await prisma.chatAnswer.upsert({
        where: {
          pairId_answererId: { pairId: pair.id, answererId: sessionId },
        },
        create: {
          pairId: pair.id,
          questionId: picked.id,
          answer,
          answererId: sessionId,
        },
        update: { answer, questionId: picked.id },
      });

      // Slots are intentionally NOT added until BOTH sides have submitted —
      // the "wait for them to finish" UX requires that the pair stays
      // pending (slot-aware /me/pending-chat returns it) for both phones
      // until the second answer lands. Otherwise the first submitter would
      // get released and could navigate away mid-flow.
      const answers = await prisma.chatAnswer.findMany({
        where: { pairId: pair.id },
        select: { answererId: true },
      });
      const answererIds = new Set(answers.map((a) => a.answererId));
      const bothAnswered =
        answererIds.has(pair.hunterId) && answererIds.has(pair.targetId);

      let added = false;
      if (bothAnswered) {
        // Both rows now exist — add slots for both sides. Each side runs its
        // own year/leader prechecks (best-effort silent skip), so we may end
        // up with one-sided slots on cross-cohort scans.
        const [callerProgress, otherProgress] = await Promise.all([
          prisma.playerProgress.findUnique({
            where: { playerId: sessionId },
            select: { assignedLeaderId: true },
          }),
          prisma.playerProgress.findUnique({
            where: { playerId: otherId },
            select: { assignedLeaderId: true },
          }),
        ]);
        if (
          await passesMutualPrechecks(
            callerShape,
            otherShape,
            callerProgress?.assignedLeaderId ?? null,
          )
        ) {
          added = await addTeammateSlot(sessionId, otherShape);
        }
        if (
          await passesMutualPrechecks(
            otherShape,
            callerShape,
            otherProgress?.assignedLeaderId ?? null,
          )
        ) {
          await addTeammateSlot(otherId, callerShape);
        }

        // Wake the OTHER side (the one who submitted first and is currently
        // sitting on the "waiting" UI) so both phones leave /chat at the
        // same moment. We don't broadcast back to the caller — they get
        // bothAnswered=true in the HTTP response and navigate locally.
        broadcastToUser(otherId, {
          type: 'chat.both_answered',
          pairId: pair.id,
          counterpartId: caller.id,
          counterpartName: caller.name,
        });
      }

      return { ok: true, bothAnswered, added, role, counterpart: otherShape };
    },
  );
}
