import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';

import type { ServiceHealth } from '@videoshare/shared-types';

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000')
});

const env = envSchema.parse(process.env);

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: [env.WEB_ORIGIN]
});

app.get('/health', async (): Promise<ServiceHealth> => {
  return {
    status: 'ok',
    service: 'videoshare-server',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime())
  };
});

app.get('/api/system/status', async () => {
  return {
    apiBaseUrl: env.PUBLIC_BASE_URL,
    webUrl: env.WEB_ORIGIN,
    tauri: 'ready' as const
  };
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.status(500).send({
    message: 'Unexpected server error',
    detail: error.message
  });
});

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
