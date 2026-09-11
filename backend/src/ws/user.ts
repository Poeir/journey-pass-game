import type { FastifyInstance } from 'fastify';
import { subscribeUser, trackSocket, unsubscribeUser } from './hub.js';

export async function userSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/user', { websocket: true, schema: { hide: true } }, async (socket, req) => {
    const employeeId = req.session.get('employeeId');
    if (!employeeId) {
      socket.close(1008, 'unauthenticated');
      return;
    }

    subscribeUser(employeeId, socket);
    trackSocket(socket);

    socket.on('close', () => unsubscribeUser(employeeId, socket));
  });
}
