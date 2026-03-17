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

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDirectory, '../../../..');

function getDefaultStoragePath(...segments: string[]): string {
  return resolve(workspaceRoot, 'storage', ...segments);
}

function resolveDatabasePath(databaseUrl?: string): string {
  if (!databaseUrl || databaseUrl.length === 0) {
    return getDefaultStoragePath('db', 'app.db');
  }

  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const rawPath = databaseUrl.slice('file:'.length);

  if (rawPath.startsWith('//')) {
    return rawPath.slice(2);
  }

  return rawPath;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_URL: z.string().optional(),
  WEB_ORIGIN: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  ROOM_TOKEN_BYTES: z.coerce.number().int().min(16).max(64).default(32),
  HLS_OUTPUT_DIR: z.string().optional(),
  MEDIA_INPUT_DIR: z.string().optional(),
  SUBTITLE_DIR: z.string().optional(),
  TEMP_DIR: z.string().optional(),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().positive().default(10),
  ROOM_IDLE_TTL_MINUTES: z.coerce.number().positive().default(180),
  HLS_RETENTION_HOURS: z.coerce.number().positive().default(72)
});

export type AppEnv = ReturnType<typeof loadEnv>;

export function loadEnv() {
  const parsedEnv = envSchema.parse(process.env);
  const databasePath = resolveDatabasePath(parsedEnv.DATABASE_URL);
  const publicBaseUrl =
    parsedEnv.PUBLIC_BASE_URL && parsedEnv.PUBLIC_BASE_URL.length > 0
      ? parsedEnv.PUBLIC_BASE_URL
      : `http://localhost:${parsedEnv.PORT}`;
  const webOrigin =
    parsedEnv.WEB_URL && parsedEnv.WEB_URL.length > 0
      ? parsedEnv.WEB_URL
      : parsedEnv.WEB_ORIGIN && parsedEnv.WEB_ORIGIN.length > 0
        ? parsedEnv.WEB_ORIGIN
        : parsedEnv.NODE_ENV === 'production'
          ? publicBaseUrl
          : 'http://localhost:5173';

  return {
    nodeEnv: parsedEnv.NODE_ENV,
    host: parsedEnv.HOST,
    port: parsedEnv.PORT,
    webOrigin,
    publicBaseUrl,
    roomTokenBytes: parsedEnv.ROOM_TOKEN_BYTES,
    databasePath,
    web: {
      distDir:
        parsedEnv.WEB_DIST_DIR ??
        resolve(workspaceRoot, 'apps', 'web', 'dist')
    },
    storage: {
      mediaDir: parsedEnv.MEDIA_INPUT_DIR ?? getDefaultStoragePath('media'),
      hlsDir: parsedEnv.HLS_OUTPUT_DIR ?? getDefaultStoragePath('hls'),
      subtitleDir:
        parsedEnv.SUBTITLE_DIR ?? getDefaultStoragePath('subtitles'),
      tempDir: parsedEnv.TEMP_DIR ?? getDefaultStoragePath('temp')
    },
    mediaProcessing: {
      ffmpegPath: parsedEnv.FFMPEG_PATH,
      ffprobePath: parsedEnv.FFPROBE_PATH
    },
    realtime: {
      transport: 'socket.io' as const,
      path: '/socket.io'
    },
    cleanup: {
      intervalMinutes: parsedEnv.CLEANUP_INTERVAL_MINUTES,
      idleRoomTtlMinutes: parsedEnv.ROOM_IDLE_TTL_MINUTES,
      hlsRetentionHours: parsedEnv.HLS_RETENTION_HOURS
    }
  };
}

export function ensureStoragePaths(env: AppEnv): void {
  mkdirSync(dirname(env.databasePath), { recursive: true });
  mkdirSync(env.storage.mediaDir, { recursive: true });
  mkdirSync(env.storage.hlsDir, { recursive: true });
  mkdirSync(env.storage.subtitleDir, { recursive: true });
  mkdirSync(env.storage.tempDir, { recursive: true });
}
