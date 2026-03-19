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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDirectory, '../..');

function parseEnvFile(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .flatMap((line) => {
        const separatorIndex = line.indexOf('=');

        if (separatorIndex <= 0) {
          return [];
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^['\"]|['\"]$/g, '');

        return key.length > 0 ? [[key, value]] : [];
      })
  );
}

function loadWorkspaceEnv(mode: string): Record<string, string> {
  const candidate = [
    resolve(workspaceRoot, '.env'),
    resolve(workspaceRoot, '.env.example')
  ].find((path) => existsSync(path));
  const fileEnv = candidate ? parseEnvFile(readFileSync(candidate, 'utf8')) : {};
  const viteEnv = loadEnv(mode, workspaceRoot, '');
  const processEnv = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : []
    )
  );

  return {
    ...fileEnv,
    ...viteEnv,
    ...processEnv
  };
}

function getNonEmptyValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildLocalUrl(protocol: string, host: string, port: string): string {
  return `${protocol}://${host}:${port}`;
}

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const env = loadWorkspaceEnv(mode);
  const publicProtocol =
    getNonEmptyValue(env.PUBLIC_PROTOCOL)
    ?? getNonEmptyValue(env.APP_PROTOCOL)
    ?? 'http';
  const publicHost =
    getNonEmptyValue(env.PUBLIC_HOST)
    ?? getNonEmptyValue(env.APP_HOST)
    ?? 'localhost';
  const serverPort = getNonEmptyValue(env.PORT) ?? '3000';
  const devWebPort = getNonEmptyValue(env.WEB_DEV_PORT) ?? '5173';
  const publicBaseUrl =
    getNonEmptyValue(env.PUBLIC_BASE_URL)
    ?? buildLocalUrl(publicProtocol, publicHost, serverPort);
  const explicitApiBaseUrl = getNonEmptyValue(env.VITE_API_BASE_URL);
  const apiBaseUrl =
    explicitApiBaseUrl
    ?? (
      isDevelopment
        ? getNonEmptyValue(env.API_BASE_URL) ?? publicBaseUrl
        : ''
    );
  const webUrl = new URL(
    buildLocalUrl(publicProtocol, publicHost, devWebPort)
  );
  const port = Number(webUrl.port || (webUrl.protocol === 'https:' ? '443' : '80'));
  const debugUrls = getNonEmptyValue(env.VITE_DEBUG_URLS) ?? '';

  return {
    base: webUrl.pathname.endsWith('/')
      ? webUrl.pathname
      : `${webUrl.pathname}/`,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl),
      'import.meta.env.VITE_DEBUG_URLS': JSON.stringify(debugUrls)
    },
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
