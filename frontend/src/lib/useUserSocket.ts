import { useEffect, useRef } from 'react';
import { useGame } from '@/game/gameStore';
import { authEndpoints } from '@/api/endpoints';

type UserWsEvent =
  | {
      type: 'pair.created';
      pairId: string;
      mode: 'trivia' | 'teammate';
      role: 'hunter' | 'target';
      counterpartId: string;
      counterpartName: string;
      createdAt: string;
    }
  | {
      type: 'trivia.found';
      cardId: string;
      cardClue: string;
      counterpartId: string;
      counterpartName: string;
      createdAt: string;
    }
  | {
      type: 'penalty.update';
      pairId: string;
      role: 'hunter' | 'target';
      targetConfirmed: boolean;
      proofPhotoUrl: string | null;
      counterpartId: string;
      counterpartName: string;
    }
  | {
      type: 'chat.both_answered';
      pairId: string;
      counterpartId: string;
      counterpartName: string;
    }
  | {
      type: 'memory.captured';
      pairId: string;
      url: string;
      uploaderId: string;
      uploaderName: string;
    }
  | {
      type: 'game.ended';
      endedAt: string;
    };

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

export function useUserSocket(employeeId: string | undefined): void {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt += 1;
      // Exponential backoff capped at 30s + up to 1s jitter to spread the
      // thundering herd when 200 clients reconnect after a server blip.
      const base = Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30_000);
      const delay = base + Math.random() * 1000;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      // Don't waste a connect attempt against a hidden tab — wait until
      // the user comes back and let the visibility handler trigger us.
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      const url = `${wsBase()}/ws/user`;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        attempt = 0;
        // On (re)connect, sync any pending penalty / chat-confirm we may have
        // missed while offline. The WS hub doesn't replay missed frames, so
        // we fall back to the authoritative server state. Especially
        // important for the target side — without this, a target who was on
        // a hidden tab during the scan broadcast would never know they got
        // pulled into a teammate pair.
        authEndpoints
          .pendingPenalty()
          .then(({ pending }) => {
            useGame.getState().setPenalty(pending);
          })
          .catch(() => {
            // Non-fatal — next visibility/reconnect will retry.
          });
        authEndpoints
          .pendingChat()
          .then(({ pending }) => {
            useGame.getState().setPendingChat(pending);
          })
          .catch(() => {
            // Non-fatal — next visibility/reconnect will retry.
          });
      });

      ws.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse(ev.data) as UserWsEvent;
          if (event.type === 'game.ended') {
            useGame.getState().setGameEnded(event.endedAt);
            return;
          }
          // Trivia-mismatch target: drive the GameShell auto-redirect so the
          // target gets pulled into the penalty page without needing any
          // notification UI. Hunter side is set by the scanner pre-navigate.
          if (
            event.type === 'pair.created' &&
            event.mode === 'trivia' &&
            event.role === 'target'
          ) {
            useGame.getState().setPenalty({ pairId: event.pairId, role: 'target' });
          }
          // Teammate pair.created: pull the user into /chat/:pairId so they
          // can complete their side of the mutual chat-confirm. We fire on
          // EITHER role:
          //   - role='target' is the natural scan-time case (scanner navigates
          //     locally, target needs the WS nudge).
          //   - role='hunter' is admin-driven — when admin removes a slot,
          //     the affected player may be the hunter on an existing pair
          //     and we need to pull them back without waiting for reload.
          // Either way the frame is lean so we round-trip /me/pending-chat
          // to fetch the counterpart's full Employee shape and the current
          // role for this user.
          if (
            event.type === 'pair.created' &&
            event.mode === 'teammate'
          ) {
            authEndpoints
              .pendingChat()
              .then(({ pending }) => {
                useGame.getState().setPendingChat(pending);
              })
              .catch(() => {
                // Non-fatal — next reconnect's open handler will retry.
              });
          }
          // Other side of a teammate pair just submitted the second chat
          // answer — release the "waiting for them" state on this device.
          // ChatConfirmPage subscribes to this signal in the store.
          if (event.type === 'chat.both_answered') {
            useGame.getState().setChatBothAnswered(event.pairId);
          }
          // Scanner uploaded the shared memory photo — flip the "waiting"
          // SuccessPage on the target side to the actual photo. SuccessPage
          // selects this directly so we don't need a refetch.
          if (event.type === 'memory.captured') {
            useGame.getState().setPairMemoryPhoto({
              pairId: event.pairId,
              url: event.url,
              uploaderId: event.uploaderId,
              uploaderName: event.uploaderName,
            });
          }
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

    const resyncPendingState = () => {
      authEndpoints
        .pendingPenalty()
        .then(({ pending }) => {
          useGame.getState().setPenalty(pending);
        })
        .catch(() => {});
      authEndpoints
        .pendingChat()
        .then(({ pending }) => {
          useGame.getState().setPendingChat(pending);
        })
        .catch(() => {});
    };

    const handleVisibility = () => {
      if (cancelled || document.hidden) return;
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // WS is up but the tab was backgrounded — mobile browsers in
        // particular throttle/buffer WS frames and we may have missed a
        // pair.created push. Re-sync pending state with the server so the
        // GameShell auto-redirects can still fire.
        resyncPendingState();
        return;
      }
      // Force a fresh attempt without backoff when the user returns.
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
  }, [employeeId]);
}
