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

import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../config/env.js';
import type { ServiceHealth, SystemDiagnostics, SystemStatus } from '../types/models.js';

type RealtimeStatus = SystemStatus['realtime'];
type CleanupStatus = SystemStatus['cleanup'];

type HealthRouteDependencies = {
  env: AppEnv;
  databasePath: string;
  realtime: RealtimeStatus;
  getCleanupStatus: () => CleanupStatus;
  getDiagnostics: () => SystemDiagnostics;
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
      realtime: dependencies.realtime,
      cleanup: dependencies.getCleanupStatus(),
      diagnostics: dependencies.getDiagnostics()
    };
  });
}
