import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerHealthRoutes } from './api/health-routes.js';
import { registerMediaRoutes } from './api/media-routes.js';
import { registerRoomRoutes } from './api/room-routes.js';
import { registerStaticRoutes } from './api/static-routes.js';
import { ensureStoragePaths, loadEnv } from './config/env.js';
import { createDatabase } from './db/database.js';
import { HttpError } from './lib/errors.js';
import { isAllowedBrowserOrigin } from './lib/origins.js';
import { createMediaService } from './services/media-service.js';
import { createRoomService } from './services/room-service.js';
import { bootstrapRealtime } from './sockets/bootstrap.js';

const desktopOrigins = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:4200',
  'http://127.0.0.1:4200'
]);

export async function buildApp() {
  const env = loadEnv();
  ensureStoragePaths(env);

  const database = createDatabase(env.databasePath);
  const mediaService = createMediaService(database, env);
  const roomService = createRoomService(database, mediaService, env);

  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    origin(origin, callback) {
      if (
        !origin ||
        desktopOrigins.has(origin) ||
        isAllowedBrowserOrigin(origin, env.webOrigin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed'), false);
    }
  });

  const realtime = await bootstrapRealtime(app, env, {
    roomService
  });

  await registerHealthRoutes(app, {
    env,
    databasePath: database.path,
    realtime
  });
  await registerRoomRoutes(app, {
    roomService
  });
  await registerMediaRoutes(app, {
    mediaService
  });
  await registerStaticRoutes(app, {
    env,
    mediaService
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      request.log.warn(
        {
          statusCode: error.statusCode,
          message: error.message
        },
        'Handled application error'
      );

      return reply.status(error.statusCode).send({
        message: error.message
      });
    }

    app.log.error(error);

    return reply.status(500).send({
      message: 'Unexpected server error',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  });

  app.addHook('onClose', async () => {
    database.connection.close();
  });

  return app;
}
