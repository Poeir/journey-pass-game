import { describe, it, expect, beforeEach, vi } from 'vitest';

const processScanMock = vi.hoisted(() => vi.fn());
// `NotFoundError` / `GameEndedError` are real classes that the route does
// `instanceof` checks against, so we re-import the real ones from the actual
// scan.js but stub `processScan` only.
vi.mock('@/domain/scan.js', async () => {
  const actual = await vi.importActual<typeof import('@/domain/scan.js')>('@/domain/scan.js');
  return {
    ...actual,
    processScan: processScanMock,
  };
});

const { buildTestApp, loginAs } = await import('@/test-utils/buildTestApp.js');
const { scanRoutes } = await import('./scans.js');
const { NotFoundError, GameEndedError } = await import('@/domain/scan.js');

const SCANNER = 'S001';
const TARGET = 'T001';

async function setup() {
  const app = await buildTestApp({
    register: async (a) => {
      await a.register(scanRoutes);
    },
  });
  const cookie = await loginAs(app, { employeeId: SCANNER });
  return { app, cookie };
}

beforeEach(() => {
  processScanMock.mockReset();
});

describe('POST /scans — auth gate', () => {
  it('401 when no session cookie is sent', async () => {
    const app = await buildTestApp({
      register: async (a) => {
        await a.register(scanRoutes);
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      payload: { scanner_id: SCANNER, scanned_id: TARGET },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthenticated' });
  });
});

describe('POST /scans — body validation', () => {
  it('400 invalid_body when scanner_id is missing', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanned_id: TARGET },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /scans — guard rails', () => {
  it('403 scanner_mismatch when scanner_id !== session.employeeId', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: 'OTHER', scanned_id: TARGET },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'scanner_mismatch' });
    expect(processScanMock).not.toHaveBeenCalled();
  });

  it('400 self_scan when scanner_id === scanned_id', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: SCANNER },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'self_scan' });
    expect(processScanMock).not.toHaveBeenCalled();
  });
});

const fakeEmp = {
  id: TARGET,
  name: 'T',
  initial: 'T',
  dept: 'X',
  year: 2024,
  isLeader: false,
};

describe('POST /scans — outcome pass-through', () => {
  it('returns 200 + match payload from processScan', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockResolvedValueOnce({
      outcome: 'match',
      card_ref: 'C1',
      stamp: { id: 'scan-1', target: fakeEmp },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET, card_ref: 'C1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'match', card_ref: 'C1' });
    expect(processScanMock).toHaveBeenCalledWith({
      scannerId: SCANNER,
      scannedId: TARGET,
      cardRef: 'C1',
    });
  });

  it('passes outcome=mismatch through unchanged', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockResolvedValueOnce({
      outcome: 'mismatch',
      pair_id: 'p1',
      target: fakeEmp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET, card_ref: 'C1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'mismatch', pair_id: 'p1' });
  });

  it('teammate-mode chat passes through (no card_ref)', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockResolvedValueOnce({
      outcome: 'chat',
      pair_id: 'p1',
      target: fakeEmp,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'chat' });
    expect(processScanMock).toHaveBeenCalledWith({
      scannerId: SCANNER,
      scannedId: TARGET,
      cardRef: undefined,
    });
  });
});

describe('POST /scans — error mapping', () => {
  it('404 not_found + resource when NotFoundError is thrown', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockRejectedValueOnce(new NotFoundError('target'));
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET, card_ref: 'C1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found', resource: 'target' });
  });

  it('409 game_ended when GameEndedError is thrown', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockRejectedValueOnce(new GameEndedError());
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET, card_ref: 'C1' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'game_ended' });
  });

  it('500 (default) when unknown error bubbles up', async () => {
    const { app, cookie } = await setup();
    processScanMock.mockRejectedValueOnce(new Error('something exploded'));
    const res = await app.inject({
      method: 'POST',
      url: '/scans',
      headers: { cookie },
      payload: { scanner_id: SCANNER, scanned_id: TARGET, card_ref: 'C1' },
    });
    expect(res.statusCode).toBe(500);
  });
});
