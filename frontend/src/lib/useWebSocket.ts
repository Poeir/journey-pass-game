import { useEffect, useRef } from 'react';

type WsEvent = { type: 'penalty.update'; targetConfirmed: boolean; proofPhotoUrl: string | null };

type Handlers = Partial<{
  [K in WsEvent['type']]: (event: Extract<WsEvent, { type: K }>) => void;
}>;

function wsBase(): string {
  const explicit = import.meta.env.VITE_WS_BASE as string | undefined;
  if (explicit) return explicit;
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
  if (apiBase.startsWith('http')) {
    return apiBase.replace(/^http/, 'ws');
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${apiBase}`;
}

export interface UseWebSocketResult {
  send: (frame: unknown) => void;
}

export function usePairSocket(
  pairId: string | undefined,
  handlers: Handlers,
): UseWebSocketResult {
  const socketRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!pairId) return;
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt += 1;
      const base = Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30_000);
      const delay = base + Math.random() * 1000;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const url = `${wsBase()}/ws/pair/${pairId}`;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        attempt = 0;
      });

      ws.addEventListener('message', (ev) => {
        try {
          const frame = JSON.parse(ev.data) as WsEvent;
          const handler = handlersRef.current[frame.type] as ((e: WsEvent) => void) | undefined;
          handler?.(frame);
        } catch {
          // Ignore malformed frames.
        }
      });

      ws.addEventListener('close', () => {
        if (cancelled) return;
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    };

    const handleVisibility = () => {
      if (cancelled || document.hidden) return;
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) return;
      attempt = 0;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connect();
    };

    connect();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [pairId]);

  return {
    send: (frame: unknown) => {
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(frame));
      }
    },
  };
}
