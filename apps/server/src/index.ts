import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await buildApp();

try {
  const address = await app.listen({
    host: env.host,
    port: env.port
  });

  app.log.info({ address }, 'VideoShare server listening');
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
