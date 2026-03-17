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
