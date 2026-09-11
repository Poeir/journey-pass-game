// Temporary admin auth — static username/password from env. The session
// cookie (jp_sess) gains an `isAdmin` flag on success, which `requireAdmin`
// checks. When the real role model lands (Azure OID list / Employee.isAdmin),
// this file plus the env vars go away in favor of OIDC-based gating.

import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/config.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

// Constant-time compare that handles unequal lengths without leaking via
// timingSafeEqual's same-length precondition.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still run a comparison against ab to keep timing roughly uniform.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/admin/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Admin'],
        summary: 'Admin login (temporary static credentials from env)',
        body: {
          type: 'object',
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
          required: ['username', 'password'],
        },
        response: {
          200: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
          401: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const userOk = safeEqual(username, env.ADMIN_USERNAME);
      const passOk = safeEqual(password, env.ADMIN_PASSWORD);
      // Compute both sides before branching so the response time does not
      // reveal which field was wrong.
      if (!userOk || !passOk) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      req.session.set('isAdmin', true);
      req.session.set('adminLoggedAt', Date.now());
      return { ok: true };
    },
  );

  app.post(
    '/admin/auth/logout',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Clear the admin flag on the current session',
        response: { 204: { type: 'null' } },
      },
    },
    async (req, reply) => {
      req.session.set('isAdmin', false);
      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/auth/me',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Whether the current session is an admin',
        response: {
          200: {
            type: 'object',
            properties: { isAdmin: { type: 'boolean' } },
            required: ['isAdmin'],
          },
        },
      },
    },
    async (req) => ({ isAdmin: req.session.get('isAdmin') === true }),
  );
}
