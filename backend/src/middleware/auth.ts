import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SessionPayload {
  employeeId: string;
  issuedAt: number;
  oauthState: string;
  oauthCodeVerifier: string;
  // Admin gate flags. Set by POST /admin/auth/login, read by requireAdmin.
  // Independent from employeeId — the same session can hold both.
  isAdmin: boolean;
  adminLoggedAt: number;
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const employeeId = req.session.get('employeeId');
  if (!employeeId) {
    reply.code(401).send({ error: 'unauthenticated' });
  }
}

/**
 * TEMPORARY admin gate. Checks the `isAdmin` flag set on the session by
 * POST /admin/auth/login (which compares against env ADMIN_USERNAME /
 * ADMIN_PASSWORD). This is a static-credential placeholder — when the real
 * role model is decided (Azure OID list / Employee.isAdmin / AdminUser
 * table), replace the body here with the real check and drop the env vars.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.session.get('isAdmin') !== true) {
    reply.code(401).send({ error: 'admin_unauthenticated' });
  }
}

declare module '@fastify/secure-session' {
  interface SessionData extends SessionPayload {}
}
