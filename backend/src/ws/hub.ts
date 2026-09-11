import type { WebSocket } from 'ws';

// Per-socket liveness flag for the heartbeat. Mobile users on flaky wifi
// often drop without sending a close frame — we'd accumulate zombies in the
// channel Maps and leak memory + file descriptors. Standard ws pattern:
// ping every 30s, terminate on missed pong (see ws docs).
const HEARTBEAT_INTERVAL_MS = 30_000;
const aliveSockets = new WeakMap<WebSocket, boolean>();

export function trackSocket(socket: WebSocket): void {
  aliveSockets.set(socket, true);
  socket.on('pong', () => {
    aliveSockets.set(socket, true);
  });
}

export type PairWsEvent =
  | { type: 'penalty.update'; targetConfirmed: boolean; proofPhotoUrl: string | null };

export type UserWsEvent =
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
  // Teammate chat: fired to the OTHER side after both hunter and target have
  // recorded their ChatAnswer rows. Frontend uses it to release the "waiting
  // for them to finish" state on the side that submitted first and navigate
  // both sides into the SuccessPage capture flow simultaneously.
  | {
      type: 'chat.both_answered';
      pairId: string;
      counterpartId: string;
      counterpartName: string;
    }
  // Teammate memory capture: fired to the OTHER side after the scanner (or
  // whoever uploaded first) saves the shared photo. Frontend swaps the
  // "waiting for {scanner} to take a photo" state for the actual photo so
  // both phones light up at the same moment.
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

export type WsEvent = PairWsEvent;

const pairChannels = new Map<string, Set<WebSocket>>();
const userChannels = new Map<string, Set<WebSocket>>();

export function subscribe(pairId: string, socket: WebSocket): void {
  if (!pairChannels.has(pairId)) pairChannels.set(pairId, new Set());
  pairChannels.get(pairId)!.add(socket);
}

export function unsubscribe(pairId: string, socket: WebSocket): void {
  const set = pairChannels.get(pairId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) pairChannels.delete(pairId);
}

export function broadcast(pairId: string, event: PairWsEvent): void {
  const set = pairChannels.get(pairId);
  if (!set) return;
  const frame = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
}

export function subscribeUser(employeeId: string, socket: WebSocket): void {
  if (!userChannels.has(employeeId)) userChannels.set(employeeId, new Set());
  userChannels.get(employeeId)!.add(socket);
}

export function unsubscribeUser(employeeId: string, socket: WebSocket): void {
  const set = userChannels.get(employeeId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) userChannels.delete(employeeId);
}

export function broadcastToUser(employeeId: string, event: UserWsEvent): void {
  const set = userChannels.get(employeeId);
  if (!set) return;
  const frame = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
}

export function broadcastGameEnded(event: Extract<UserWsEvent, { type: 'game.ended' }>): void {
  const frame = JSON.stringify(event);
  for (const set of userChannels.values()) {
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    }
  }
}

let heartbeatTimer: NodeJS.Timeout | null = null;

export function startHeartbeat(): void {
  if (heartbeatTimer) return;
  // Reaps stale sockets from both channel maps every 30s. If the prior tick's
  // ping didn't get a pong by now, the socket is dead — terminate and remove.
  // unref() so the timer doesn't keep the process alive on shutdown.
  heartbeatTimer = setInterval(() => {
    let reaped = 0;
    const reap = (set: Set<WebSocket>): void => {
      for (const ws of set) {
        if (ws.readyState !== ws.OPEN) {
          set.delete(ws);
          reaped++;
          continue;
        }
        if (aliveSockets.get(ws) === false) {
          try {
            ws.terminate();
          } catch {
            // ignore — socket already closing
          }
          set.delete(ws);
          reaped++;
          continue;
        }
        aliveSockets.set(ws, false);
        try {
          ws.ping();
        } catch {
          // ignore — will be reaped next tick
        }
      }
    };
    const reapChannels = (channels: Map<string, Set<WebSocket>>): void => {
      for (const [key, set] of channels) {
        reap(set);
        if (set.size === 0) {
          channels.delete(key);
        }
      }
    };
    reapChannels(pairChannels);
    reapChannels(userChannels);
    if (reaped > 0) {
      // Bursts of reaps suggest a network-side issue (wifi outage, ingress
      // restart) rather than the usual mobile-drop trickle.
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'ws sockets reaped',
          reaped,
          pairChannels: pairChannels.size,
          userChannels: userChannels.size,
          time: new Date().toISOString(),
        }),
      );
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
