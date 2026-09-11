import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/prisma.js';
import { subscribe, trackSocket, unsubscribe } from './hub.js';

export async function pairSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { pairId: string } }>('/ws/pair/:pairId', { websocket: true, schema: { hide: true } }, async (socket, req) => {
    const sessionId = req.session.get('employeeId');
    if (!sessionId) {
      socket.close(1008, 'unauthenticated');
      return;
    }

    const pair = await prisma.pair.findUnique({ where: { id: req.params.pairId } });
    if (!pair || (pair.hunterId !== sessionId && pair.targetId !== sessionId)) {
      socket.close(1008, 'forbidden');
      return;
    }

    subscribe(pair.id, socket);
    trackSocket(socket);

    socket.on('close', () => unsubscribe(pair.id, socket));
  });
}
