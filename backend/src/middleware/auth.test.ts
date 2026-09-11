import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requireSession, requireAdmin } from './auth.js';

interface MockReply {
  code: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeReply(): MockReply {
  const reply = {
    code: vi.fn(),
    send: vi.fn(),
  };
  // Make `code` chainable like Fastify's real reply.
  reply.code.mockReturnValue(reply);
  return reply;
}

function makeReq(sessionGet: (key: string) => unknown): FastifyRequest {
  return {
    session: { get: vi.fn(sessionGet) },
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireSession', () => {
  it('replies 401 with body `{error:"unauthenticated"}` when no employeeId', async () => {
    const reply = makeReply();
    const req = makeReq(() => undefined);
    await requireSession(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'unauthenticated' });
  });

  it('passes (does not touch reply) when employeeId is present', async () => {
    const reply = makeReply();
    const req = makeReq((key) => (key === 'employeeId' ? 'E001' : undefined));
    await requireSession(req, reply as unknown as FastifyReply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('treats empty string as missing (falsy)', async () => {
    const reply = makeReply();
    const req = makeReq(() => '');
    await requireSession(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });
});

describe('requireAdmin', () => {
  it('replies 401 `admin_unauthenticated` when isAdmin flag is missing', async () => {
    const reply = makeReply();
    const req = makeReq(() => undefined);
    await requireAdmin(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'admin_unauthenticated' });
  });

  it('blocks when isAdmin is exactly the boolean `false`', async () => {
    const reply = makeReply();
    const req = makeReq((key) => (key === 'isAdmin' ? false : undefined));
    await requireAdmin(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('blocks when isAdmin is the string "true" (must be strict boolean true)', async () => {
    const reply = makeReply();
    const req = makeReq((key) => (key === 'isAdmin' ? 'true' : undefined));
    await requireAdmin(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('passes when isAdmin === true', async () => {
    const reply = makeReply();
    const req = makeReq((key) => (key === 'isAdmin' ? true : undefined));
    await requireAdmin(req, reply as unknown as FastifyReply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('is independent from employeeId — a player session without admin flag is still blocked', async () => {
    const reply = makeReply();
    const req = makeReq((key) => (key === 'employeeId' ? 'E001' : undefined));
    await requireAdmin(req, reply as unknown as FastifyReply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });
});
