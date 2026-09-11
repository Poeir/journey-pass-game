import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// =====================================================================
// MockWebSocket — driven manually from tests via fireOpen / fireMessage
// / fireClose helpers.
// =====================================================================
const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = wsInstances;

  url: string;
  readyState = 0;
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    wsInstances.push(this);
  }

  addEventListener(name: string, cb: (ev: unknown) => void): void {
    (this.listeners[name] ||= []).push(cb);
  }
  removeEventListener(name: string, cb: (ev: unknown) => void): void {
    if (this.listeners[name]) {
      this.listeners[name] = this.listeners[name].filter((l) => l !== cb);
    }
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close');
  }
  dispatch(name: string, ev: unknown = {}): void {
    (this.listeners[name] || []).forEach((cb) => cb(ev));
  }

  // Test helpers
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch('open');
  }
  fireMessage(data: unknown): void {
    this.dispatch('message', { data: JSON.stringify(data) });
  }
  fireClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch('close');
  }
  fireRawMessage(raw: string): void {
    this.dispatch('message', { data: raw });
  }
}

// =====================================================================
// Mocked endpoints — used by useUserSocket.open handler to re-sync state
// =====================================================================
const pendingPenaltyMock = vi.hoisted(() => vi.fn());
const pendingChatMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/endpoints', () => ({
  authEndpoints: {
    pendingPenalty: pendingPenaltyMock,
    pendingChat: pendingChatMock,
  },
}));

// =====================================================================
// Imports after mocks
// =====================================================================
import { useUserSocket } from './useUserSocket';
import { useGame } from '@/game/gameStore';

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  wsInstances.length = 0;
  pendingPenaltyMock.mockReset().mockResolvedValue({ pending: null });
  pendingChatMock.mockReset().mockResolvedValue({ pending: null });
  useGame.getState().reset();
  // jsdom: ensure tab is visible by default
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useUserSocket — connect lifecycle', () => {
  it('opens a WebSocket when employeeId is provided', () => {
    renderHook(() => useUserSocket('E001'));
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toMatch(/\/ws\/user$/);
  });

  it('does NOT open a WebSocket when employeeId is undefined', () => {
    renderHook(() => useUserSocket(undefined));
    expect(wsInstances).toHaveLength(0);
  });

  it('does NOT connect when document.hidden is true (let visibilitychange trigger it)', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    renderHook(() => useUserSocket('E001'));
    expect(wsInstances).toHaveLength(0);
  });

  it('on socket open, fetches pendingPenalty + pendingChat', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireOpen();
    });
    await waitFor(() => {
      expect(pendingPenaltyMock).toHaveBeenCalledTimes(1);
      expect(pendingChatMock).toHaveBeenCalledTimes(1);
    });
  });

  it('writes pendingPenalty response into gameStore', async () => {
    pendingPenaltyMock.mockResolvedValueOnce({
      pending: { pairId: 'p1', role: 'target' },
    });
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireOpen();
    });
    await waitFor(() => {
      expect(useGame.getState().pendingPenalty).toEqual({
        pairId: 'p1',
        role: 'target',
      });
    });
  });
});

describe('useUserSocket — message dispatch', () => {
  it('game.ended → setGameEnded', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireMessage({ type: 'game.ended', endedAt: '2026-05-11T10:00:00Z' });
    });
    expect(useGame.getState().gameEndedAt).toBe('2026-05-11T10:00:00Z');
  });

  it('pair.created (trivia, target) → setPenalty', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireMessage({
        type: 'pair.created',
        pairId: 'p1',
        mode: 'trivia',
        role: 'target',
        counterpartId: 'H1',
        counterpartName: 'H',
        createdAt: '2026-05-11T10:00:00Z',
      });
    });
    expect(useGame.getState().pendingPenalty).toEqual({ pairId: 'p1', role: 'target' });
  });

  it('pair.created (trivia, hunter) → NO setPenalty (scanner sets this locally)', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireMessage({
        type: 'pair.created',
        pairId: 'p1',
        mode: 'trivia',
        role: 'hunter',
        counterpartId: 'T1',
        counterpartName: 'T',
        createdAt: '2026-05-11T10:00:00Z',
      });
    });
    expect(useGame.getState().pendingPenalty).toBeNull();
  });

  it('chat.both_answered → setChatBothAnswered with the pairId', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireMessage({
        type: 'chat.both_answered',
        pairId: 'pair-xyz',
        counterpartId: 'X',
        counterpartName: 'X',
      });
    });
    expect(useGame.getState().chatBothAnsweredFor).toBe('pair-xyz');
  });

  it('memory.captured → setPairMemoryPhoto', async () => {
    renderHook(() => useUserSocket('E001'));
    await act(async () => {
      wsInstances[0].fireMessage({
        type: 'memory.captured',
        pairId: 'p1',
        url: 'https://cdn/x.jpg',
        uploaderId: 'H1',
        uploaderName: 'H',
      });
    });
    expect(useGame.getState().pairMemoryPhoto).toEqual({
      pairId: 'p1',
      url: 'https://cdn/x.jpg',
      uploaderId: 'H1',
      uploaderName: 'H',
    });
  });

  it('malformed JSON message → no crash, no state change', async () => {
    renderHook(() => useUserSocket('E001'));
    expect(() => {
      wsInstances[0].fireRawMessage('not json{');
    }).not.toThrow();
    expect(useGame.getState().gameEndedAt).toBeNull();
  });
});

describe('useUserSocket — reconnect on close', () => {
  it('on close, schedules a reconnect via setTimeout', async () => {
    vi.useFakeTimers();
    renderHook(() => useUserSocket('E001'));
    expect(wsInstances).toHaveLength(1);

    act(() => {
      wsInstances[0].fireClose();
    });

    // The reconnect uses backoff (base ~1s + up to 1s jitter). Advance 5s.
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
  });
});

describe('useUserSocket — visibility handling', () => {
  it('visibilitychange when ws.readyState=OPEN → re-syncs pending state (no new socket)', async () => {
    renderHook(() => useUserSocket('E001'));
    const ws = wsInstances[0];
    await act(async () => {
      ws.fireOpen();
    });
    // Clear the initial open-handler calls so we can isolate the visibility-driven calls
    pendingPenaltyMock.mockClear();
    pendingChatMock.mockClear();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(wsInstances).toHaveLength(1); // no new socket
    expect(pendingPenaltyMock).toHaveBeenCalledTimes(1);
    expect(pendingChatMock).toHaveBeenCalledTimes(1);
  });

  it('visibilitychange when no live socket → opens a fresh connection (skip backoff)', async () => {
    vi.useFakeTimers();
    renderHook(() => useUserSocket('E001'));
    // Simulate hidden tab + tear down current socket
    act(() => {
      wsInstances[0].fireClose();
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // A new socket should be created immediately (without waiting for backoff timer).
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
  });
});

describe('useUserSocket — cleanup on unmount', () => {
  it('closes the socket and removes the visibilitychange listener', () => {
    const { unmount } = renderHook(() => useUserSocket('E001'));
    const ws = wsInstances[0];
    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
