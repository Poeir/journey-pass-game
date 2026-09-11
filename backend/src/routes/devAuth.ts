// Dev-only "log in as any employee" route. Bypasses Azure SSO entirely so
// local dev / QA can test the flow without a Microsoft account or company
// network. Registered in `server.ts` ONLY when `env.DEV_LOGIN_ENABLED` is
// true; `config.ts` already refuses to boot if that flag is set in
// production. Do not gate any per-employee logic from here — the session
// shape it writes is identical to the SSO callback's
// (`employeeId` + `issuedAt`).

import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { getEmployee } from '@/lib/employeeCache.js';

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

export async function devAuthRoutes(app: FastifyInstance): Promise<void> {
  app.log.warn(
    'DEV_LOGIN_ENABLED=true — registering /auth/dev/* routes. NEVER use in production.',
  );

  app.get(
    '/auth/dev/employees',
    {
      schema: {
        tags: ['Auth'],
        summary: '[DEV ONLY] List employees for the dev login picker',
        description:
          'Returns a lightweight roster (id, name, dept, year, isLeader) used by the welcome page dev-login UI to populate a picker. Only registered when DEV_LOGIN_ENABLED is true.',
        response: {
          200: {
            type: 'object',
            properties: {
              employees: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    dept: { type: 'string' },
                    year: { type: 'integer' },
                    isLeader: { type: 'boolean' },
                  },
                  required: ['id', 'name', 'dept', 'year', 'isLeader'],
                },
              },
            },
            required: ['employees'],
          },
        },
      },
    },
    async () => {
      const rows = await prisma.employee.findMany({
        select: { id: true, name: true, dept: true, year: true, isLeader: true },
        orderBy: [{ isLeader: 'desc' }, { name: 'asc' }],
      });
      return { employees: rows };
    },
  );

  app.post(
    '/auth/dev/login',
    {
      config: {
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Auth'],
        summary: '[DEV ONLY] Log in as any employee without SSO',
        description:
          'Sets `employeeId` + `issuedAt` on the session cookie just like the Azure callback does. Only registered when DEV_LOGIN_ENABLED is true.',
        body: {
          type: 'object',
          properties: { employeeId: { type: 'string', minLength: 1 } },
          required: ['employeeId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              employeeId: { type: 'string' },
            },
            required: ['ok', 'employeeId'],
          },
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { employeeId } = req.body as { employeeId: string };
      const emp = await getEmployee(employeeId);
      if (!emp) return reply.code(404).send({ error: 'employee_not_found' });

      req.session.set('employeeId', emp.id);
      req.session.set('issuedAt', Date.now());
      req.log.warn(
        { employeeId: emp.id, employeeName: emp.name },
        'DEV LOGIN — session issued without SSO',
      );
      return { ok: true, employeeId: emp.id };
    },
  );
}
