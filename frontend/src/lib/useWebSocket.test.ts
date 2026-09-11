import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// usePairSocket follows the same reconnect+visibility pattern as
// useUserSocket — this file covers only the things that differ from that
// pattern: handler routing by frame type, conditional connection on pairId,
// and the send() return value.

const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
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
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch('open');
  }
  fireMessage(data: unknown): void {
    this.dispatch('message', { data: JSON.stringify(data) });
  }
}

import { usePairSocket } from './useWebSocket';

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  wsInstances.length = 0;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePairSocket — connection', () => {
  it('connects to /ws/pair/:pairId when pairId is provided', () => {
    renderHook(() => usePairSocket('pair-1', {}));
    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0].url).toMatch(/\/ws\/pair\/pair-1$/);
  });

  it('does NOT connect when pairId is undefined', () => {
    renderHook(() => usePairSocket(undefined, {}));
    expect(wsInstances).toHaveLength(0);
  });
});

describe('usePairSocket — handler routing', () => {
  it('invokes handlers[frame.type] when a matching message arrives', async () => {
    const onPenaltyUpdate = vi.fn();
    renderHook(() => usePairSocket('pair-1', { 'penalty.update': onPenaltyUpdate }));

    await act(async () => {
      wsInstances[0].fireMessage({
        type: 'penalty.update',
        targetConfirmed: true,
        proofPhotoUrl: 'https://cdn/x.jpg',
      });
    });

    expect(onPenaltyUpdate).toHaveBeenCalledWith({
      type: 'penalty.update',
      targetConfirmed: true,
      proofPhotoUrl: 'https://cdn/x.jpg',
    });
  });

  it('does NOT crash on an unknown frame type (no handler registered)', async () => {
    renderHook(() => usePairSocket('pair-1', {}));
    expect(() => {
      wsInstances[0].fireMessage({ type: 'penalty.update', targetConfirmed: true, proofPhotoUrl: null });
    }).not.toThrow();
  });

  it('does NOT crash on malformed JSON', async () => {
    renderHook(() => usePairSocket('pair-1', {}));
    expect(() => {
      wsInstances[0].dispatch('message', { data: 'not json{' });
    }).not.toThrow();
  });
});

describe('usePairSocket — send()', () => {
  it('send is a no-op when readyState is not OPEN', () => {
    const { result } = renderHook(() => usePairSocket('pair-1', {}));
    result.current.send({ hi: true });
    expect(wsInstances[0].send).not.toHaveBeenCalled();
  });

  it('send forwards a JSON-encoded frame when readyState=OPEN', () => {
    const { result } = renderHook(() => usePairSocket('pair-1', {}));
    act(() => {
      wsInstances[0].fireOpen();
    });
    result.current.send({ hi: true });
    expect(wsInstances[0].send).toHaveBeenCalledWith('{"hi":true}');
  });
});
