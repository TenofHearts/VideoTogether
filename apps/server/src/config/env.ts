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
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  ROOM_TOKEN_BYTES: z.coerce.number().int().min(16).max(64).default(32),
  HLS_OUTPUT_DIR: z.string().optional(),
  MEDIA_INPUT_DIR: z.string().optional(),
  SUBTITLE_DIR: z.string().optional(),
  TEMP_DIR: z.string().optional(),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe')
});

export type AppEnv = ReturnType<typeof loadEnv>;

export function loadEnv() {
  const parsedEnv = envSchema.parse(process.env);
  const databasePath = resolveDatabasePath(parsedEnv.DATABASE_URL);

  return {
    host: parsedEnv.HOST,
    port: parsedEnv.PORT,
    webOrigin: parsedEnv.WEB_ORIGIN,
    publicBaseUrl:
      parsedEnv.PUBLIC_BASE_URL && parsedEnv.PUBLIC_BASE_URL.length > 0
        ? parsedEnv.PUBLIC_BASE_URL
        : `http://localhost:${parsedEnv.PORT}`,
    roomTokenBytes: parsedEnv.ROOM_TOKEN_BYTES,
    databasePath,
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
