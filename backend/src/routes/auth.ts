import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { requireSession } from '@/middleware/auth.js';
import { gameEndAt, isGameEnded } from '@/lib/gameClock.js';
import { getEmployee, getEmployeesByIds } from '@/lib/employeeCache.js';
import { getCriteriaClues, getTriviaCardsByIds } from '@/lib/triviaCardCache.js';
import { toEmployeeShape } from '@/domain/scan.js';
import { env } from '@/config.js';
import {
  acquireTokenByCode,
  buildRedirectUri,
  generatePkce,
  getAuthCodeUrl,
} from '@/lib/azureClient.js';

function toProfile(emp: {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  dept: string;
  year: number;
  email: string | null;
  isLeader: boolean;
  photoUrl: string | null;
}) {
  return {
    id: emp.id,
    name: emp.name,
    nickname: emp.nickname,
    position: emp.position,
    initial: emp.name.charAt(0),
    dept: emp.dept,
    year: emp.year,
    email: emp.email ?? '',
    isLeader: emp.isLeader,
    photoUrl: emp.photoUrl ?? null,
  };
}

const profileSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    nickname: { type: ['string', 'null'] },
    position: { type: ['string', 'null'] },
    initial: { type: 'string' },
    dept: { type: 'string' },
    year: { type: 'integer' },
    email: { type: 'string' },
    isLeader: { type: 'boolean' },
    photoUrl: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'nickname', 'position', 'initial', 'dept', 'year', 'email', 'isLeader', 'photoUrl'],
} as const;

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

function loginErrorRedirect(reply: { redirect: (url: string) => unknown }, code: string): void {
  // No dedicated /login page anymore — bounce back to the welcome page with
  // the error code, where WelcomePage renders an inline banner.
  const url = `${env.FRONTEND_ORIGIN}/?error=${encodeURIComponent(code)}`;
  reply.redirect(url);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/auth/azure/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Start Azure Entra ID sign-in',
        description: 'Redirects the browser to Microsoft for Authorization Code Flow with PKCE.',
        response: { 302: { type: 'null', description: 'Redirect to Microsoft' } },
      },
    },
    async (req, reply) => {
      const { state, codeVerifier, codeChallenge } = await generatePkce();
      req.session.set('oauthState', state);
      req.session.set('oauthCodeVerifier', codeVerifier);
      const redirectUri = buildRedirectUri(req);
      const authUrl = await getAuthCodeUrl(state, codeChallenge, redirectUri);
      reply.redirect(authUrl);
    },
  );

  app.get(
    '/auth/azure/callback',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Azure Entra ID OIDC callback',
        description:
          'Handles the redirect back from Microsoft, exchanges the auth code for an id_token, links the employee by email, then sets the `jp_sess` session cookie and redirects to the frontend.',
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
        response: { 302: { type: 'null', description: 'Redirect to frontend' } },
      },
    },
    async (req, reply) => {
      const q = req.query as { code?: string; state?: string; error?: string };
      if (q.error) {
        req.log.warn({ azureError: q.error }, 'azure callback returned error');
        return loginErrorRedirect(reply, 'auth_failed');
      }
      const expectedState = req.session.get('oauthState');
      const codeVerifier = req.session.get('oauthCodeVerifier');
      // One-shot — clear the PKCE material from the session regardless of success.
      req.session.set('oauthState', undefined as unknown as string);
      req.session.set('oauthCodeVerifier', undefined as unknown as string);

      if (!q.code || !q.state || !expectedState || !codeVerifier) {
        req.log.warn('azure callback missing code/state or session lost');
        return loginErrorRedirect(reply, 'auth_failed');
      }
      if (q.state !== expectedState) {
        req.log.warn('azure callback state mismatch');
        return loginErrorRedirect(reply, 'auth_failed');
      }

      const redirectUri = buildRedirectUri(req);
      let claims;
      try {
        claims = await acquireTokenByCode(q.code, codeVerifier, redirectUri);
      } catch (err) {
        req.log.warn({ err }, 'azure token exchange failed');
        return loginErrorRedirect(reply, 'auth_failed');
      }

      req.log.info(
        { oid: claims.oid, email: claims.email, name: claims.name, tid: claims.tid },
        'azure SSO claims received',
      );

      // Look up the employee by email returned from Microsoft.
      const emp = claims.email
        ? await prisma.employee.findUnique({ where: { email: claims.email } })
        : null;
      if (!emp) {
        req.log.warn(
          { oid: claims.oid, email: claims.email },
          'azure SSO succeeded but no matching Employee row',
        );
        return loginErrorRedirect(reply, 'not_registered');
      }

      req.session.set('employeeId', emp.id);
      req.session.set('issuedAt', Date.now());
      req.log.info(
        { employeeId: emp.id, employeeName: emp.name, employeeEmail: emp.email, claimsEmail: claims.email },
        'azure SSO login',
      );
      reply.redirect(`${env.FRONTEND_ORIGIN}/user`);
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log out and clear session',
        security: [{ sessionCookie: [] }],
        response: { 204: { type: 'null', description: 'No content' } },
      },
    },
    async (req, reply) => {
      const employeeId = req.session.get('employeeId');
      if (employeeId) {
        req.log.info({ employeeId }, 'user logged out');
      }
      req.session.delete();
      reply.code(204).send();
    },
  );

  app.get(
    '/me',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Auth'],
        summary: 'Get the current logged-in profile',
        security: [{ sessionCookie: [] }],
        response: {
          200: profileSchema,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const employeeId = req.session.get('employeeId')!;
      const emp = await getEmployee(employeeId);
      if (!emp) return reply.code(404).send({ error: 'not_found' });
      return toProfile(emp);
    },
  );

  app.get(
    '/me/progress',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Auth'],
        summary: 'Get the current player progress (cards, stamps, teammates)',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    index: { type: 'integer' },
                    clue: { type: 'string' },
                  },
                  required: ['id', 'index', 'clue'],
                },
              },
              triviaStamps: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    initial: { type: 'string' },
                    dept: { type: 'string' },
                    year: { type: 'integer' },
                    isLeader: { type: 'boolean' },
                    photoUrl: { type: ['string', 'null'] },
                  },
                  required: ['id', 'name', 'initial', 'dept', 'year', 'isLeader', 'photoUrl'],
                },
              },
              teammateSlots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    initial: { type: 'string' },
                    dept: { type: 'string' },
                    year: { type: 'integer' },
                    isLeader: { type: 'boolean' },
                    photoUrl: { type: ['string', 'null'] },
                  },
                  required: ['id', 'name', 'initial', 'dept', 'year', 'isLeader', 'photoUrl'],
                },
              },
              completedAt: { type: ['string', 'null'] },
              gameEndedAt: { type: ['string', 'null'] },
              leaderClue: { type: ['string', 'null'] },
            },
            required: ['cards', 'triviaStamps', 'teammateSlots', 'completedAt', 'gameEndedAt', 'leaderClue'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const employeeId = req.session.get('employeeId')!;
      // `completedAt` is strictly "the player actually finished all quests" — set only by
      // POST /completion. Game-end is signaled via `gameEndedAt` (gameClock); the frontend
      // routes to the time-up page off that, not off `completedAt`.
      const progress = await prisma.playerProgress.findUnique({
        where: { playerId: employeeId },
        include: {
          assignedCards: { orderBy: { position: 'asc' }, select: { cardId: true } },
          triviaStamps: { select: { cardId: true, targetId: true } },
          teammateSlots: { orderBy: { createdAt: 'asc' }, select: { memberId: true } },
        },
      });

      const assignedIds = progress?.assignedCards.map((a) => a.cardId) ?? [];
      const stampTargetIds = Array.from(
        new Set(progress?.triviaStamps.map((s) => s.targetId) ?? []),
      );
      const slotMemberIds = progress?.teammateSlots.map((s) => s.memberId) ?? [];

      // Fan out the four independent lookups — cards, stamp targets, slot
      // members, and the assigned leader — in parallel. All hit in-memory
      // caches (or short-circuit on empty input).
      const [cardRows, stampTargets, slotMembers, leaderEmp] = await Promise.all([
        getTriviaCardsByIds(assignedIds),
        getEmployeesByIds(stampTargetIds),
        getEmployeesByIds(slotMemberIds),
        progress?.assignedLeaderId ? getEmployee(progress.assignedLeaderId) : Promise.resolve(null),
      ]);

      const cardById = new Map(cardRows.map((c) => [c.id, c]));
      const cards = assignedIds
        .map((id) => cardById.get(id))
        .filter((c): c is (typeof cardRows)[number] => c !== undefined)
        .map((c) => ({ id: c.id, index: c.index, clue: c.clue }));

      const targetById = new Map(stampTargets.map((e) => [e.id, e]));
      const triviaStamps: Record<string, {
        id: string;
        name: string;
        initial: string;
        dept: string;
        year: number;
        isLeader: boolean;
        photoUrl: string | null;
      }> = {};
      for (const stamp of progress?.triviaStamps ?? []) {
        const e = targetById.get(stamp.targetId);
        if (!e) continue;
        triviaStamps[stamp.cardId] = {
          id: e.id,
          name: e.name,
          initial: e.name.charAt(0),
          dept: e.dept,
          year: e.year,
          isLeader: e.isLeader === true,
          photoUrl: e.photoUrl ?? null,
        };
      }

      const memberById = new Map(slotMembers.map((e) => [e.id, e]));
      const teammateSlots = slotMemberIds
        .map((id) => memberById.get(id))
        .filter((e): e is (typeof slotMembers)[number] => e !== undefined)
        .map((e) => ({
          id: e.id,
          name: e.name,
          initial: e.name.charAt(0),
          dept: e.dept,
          year: e.year,
          isLeader: e.isLeader === true,
          photoUrl: e.photoUrl ?? null,
        }));

      return {
        cards,
        triviaStamps,
        teammateSlots,
        completedAt: progress?.completedAt?.toISOString() ?? null,
        gameEndedAt: isGameEnded() ? gameEndAt().toISOString() : null,
        leaderClue: leaderEmp?.leaderClue ?? null,
      };
    },
  );

  app.get(
    '/me/pending-penalty',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Auth'],
        summary: 'Check if the user has an unconfirmed trivia penalty',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              pending: {
                anyOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    properties: {
                      pairId: { type: 'string' },
                      role: { type: 'string', enum: ['hunter', 'target'] },
                    },
                    required: ['pairId', 'role'],
                  },
                ],
              },
            },
            required: ['pending'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const employeeId = req.session.get('employeeId')!;
      // Pending = the user is in a TRIVIA pair whose TriviaPenalty side-row
      // hasn't been confirmed yet. Joining via the relation filter keeps the
      // query expressible in Prisma; the (hunterId|targetId, kind, createdAt)
      // composite indexes still cover the OR + orderBy.
      const pair = await prisma.pair.findFirst({
        where: {
          kind: 'TRIVIA',
          triviaPenalty: { is: { targetConfirmed: false } },
          OR: [
            { hunterId: employeeId },
            { targetId: employeeId },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!pair) return { pending: null };
      const role = pair.hunterId === employeeId ? 'hunter' : 'target';
      return { pending: { pairId: pair.id, role } };
    },
  );

  app.get(
    '/me/pending-chat',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Auth'],
        summary: 'Check if the user has an unanswered teammate chat-confirm',
        description:
          'Returns the most recent TEAMMATE pair where the user is hunter or target and has NOT yet recorded a ChatAnswer. Drives the auto-redirect into /chat/:pairId on login / WS reconnect / hydrate so the target side can complete the mutual-add without scanning back.',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              pending: {
                anyOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    properties: {
                      pairId: { type: 'string' },
                      role: { type: 'string', enum: ['hunter', 'target'] },
                      counterpart: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          initial: { type: 'string' },
                          dept: { type: 'string' },
                          year: { type: 'integer' },
                          isLeader: { type: 'boolean' },
                          photoUrl: { type: ['string', 'null'] },
                        },
                        required: ['id', 'name', 'initial', 'dept', 'year', 'isLeader', 'photoUrl'],
                      },
                    },
                    required: ['pairId', 'role', 'counterpart'],
                  },
                ],
              },
            },
            required: ['pending'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const employeeId = req.session.get('employeeId')!;
      // The user's TeammateSlot is the single source of truth for "I've
      // completed my side of this pair". Returning the latest TEAMMATE pair
      // where the user is involved AND doesn't currently hold a slot for
      // the counterpart covers three cases uniformly:
      //   - never confirmed yet (the original mutual-add target case)
      //   - confirmed but admin removed the slot (player detail / progress reset)
      //   - confirmed but the counterpart was somehow re-pulled in
      // Tying this to ChatAnswer instead would silently leave admin-cleared
      // players unable to re-engage — they'd look "answered" forever.
      const pair = await prisma.pair.findFirst({
        where: {
          kind: 'TEAMMATE',
          OR: [
            {
              hunterId: employeeId,
              target: {
                teammateSlotsAsMember: { none: { playerId: employeeId } },
              },
            },
            {
              targetId: employeeId,
              hunter: {
                teammateSlotsAsMember: { none: { playerId: employeeId } },
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!pair) return { pending: null };
      const role = pair.hunterId === employeeId ? 'hunter' : 'target';
      const otherId = role === 'hunter' ? pair.targetId : pair.hunterId;
      const others = await getEmployeesByIds([otherId]);
      const other = others[0];
      if (!other) return { pending: null };
      return {
        pending: {
          pairId: pair.id,
          role,
          counterpart: toEmployeeShape(other),
        },
      };
    },
  );

  app.get(
    '/me/criteria',
    {
      preHandler: requireSession,
      schema: {
        tags: ['Auth'],
        summary: 'Get the trivia clues that other players will use to find this user',
        description:
          'Returns the clue text of every TriviaCard whose `targets` include the current employee. Used by UserProfilePage to show "what others will look for in you".',
        security: [{ sessionCookie: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              criteria: { type: 'array', items: { type: 'string' } },
            },
            required: ['criteria'],
          },
          401: errorSchema,
        },
      },
    },
    async (req) => {
      const employeeId = req.session.get('employeeId')!;
      return { criteria: await getCriteriaClues(employeeId) };
    },
  );
}
