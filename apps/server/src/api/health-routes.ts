import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../config/env.js';
import type { ServiceHealth, SystemStatus } from '../types/models.js';

type RealtimeStatus = SystemStatus['realtime'];

type HealthRouteDependencies = {
  env: AppEnv;
  databasePath: string;
  realtime: RealtimeStatus;
};

export async function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: HealthRouteDependencies
) {
  app.get('/health', async (): Promise<ServiceHealth> => {
    return {
      status: 'ok',
      service: 'videoshare-server',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    };
  });

  app.get('/api/system/status', async (): Promise<SystemStatus> => {
    return {
      apiBaseUrl: dependencies.env.publicBaseUrl,
      webUrl: dependencies.env.webOrigin,
      tauri: 'ready',
      database: {
        path: dependencies.databasePath,
        connected: true
      },
      storage: dependencies.env.storage,
      realtime: dependencies.realtime
    };
  });
}

