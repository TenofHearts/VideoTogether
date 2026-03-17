/*
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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
import { createCleanupService } from './services/cleanup-service.js';
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
  const cleanupService = createCleanupService(database, env, {
    getActiveProcessingJobCount: () =>
      mediaService.getActiveProcessingJobCount()
  });

  roomService.closeAllRooms();

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
    realtime,
    getCleanupStatus: () => cleanupService.getStatus(),
    getDiagnostics: () => cleanupService.getDiagnostics()
  });
  await registerRoomRoutes(app, {
    roomService
  });
  await registerMediaRoutes(app, {
    mediaService,
    roomService
  });
  await registerStaticRoutes(app, {
    env,
    mediaService
  });

  const cleanupTimer = setInterval(
    () => {
      try {
        const summary = cleanupService.runNow();
        app.log.info({ summary }, 'Completed maintenance cleanup pass');
      } catch (error) {
        app.log.error(error, 'Maintenance cleanup pass failed');
      }
    },
    env.cleanup.intervalMinutes * 60 * 1000
  );

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
    clearInterval(cleanupTimer);
    roomService.closeAllRooms();
    database.connection.close();
  });

  return app;
}
