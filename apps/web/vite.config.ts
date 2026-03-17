import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDirectory, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  const webUrl = new URL(env.WEB_URL || 'http://localhost:5173');
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://localhost:3000';
  const port = Number(webUrl.port || (webUrl.protocol === 'https:' ? '443' : '80'));

  return {
    base: webUrl.pathname.endsWith('/')
      ? webUrl.pathname
      : `${webUrl.pathname}/`,
    plugins: [react()],
    server: {
      host: webUrl.hostname === 'localhost' ? '0.0.0.0' : webUrl.hostname,
      port,
      strictPort: true,
      proxy: {
        '/health': {
          target: apiBaseUrl,
          changeOrigin: true
        },
        '/api': {
          target: apiBaseUrl,
          changeOrigin: true
        }
      }
    }
  };
});
