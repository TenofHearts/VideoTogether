import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../config/env.js';
import { isAllowedBrowserOrigin } from '../lib/origins.js';
import type { SystemStatus } from '../types/models.js';

type RealtimeStatus = SystemStatus['realtime'];

export async function bootstrapRealtime(
  app: FastifyInstance,
  env: AppEnv
): Promise<RealtimeStatus> {
  const io = new Server(app.server, {
    path: env.realtime.path,
    cors: {
      origin(origin, callback) {
        if (!origin || isAllowedBrowserOrigin(origin, env.webOrigin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin not allowed'));
      }
    }
  });

  io.on('connection', (socket) => {
    app.log.info({ socketId: socket.id }, 'Socket.IO client connected');
    socket.emit('system:hello', {
      message: 'VideoShare realtime ready'
    });
    socket.on('disconnect', () => {
      app.log.info({ socketId: socket.id }, 'Socket.IO client disconnected');
    });
  });

  app.addHook('onClose', async () => {
    await io.close();
  });

  return {
    transport: env.realtime.transport,
    path: env.realtime.path,
    status: 'ready',
    detail: 'Socket.IO server attached to the Fastify HTTP server'
  };
}
