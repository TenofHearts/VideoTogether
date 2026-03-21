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

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isSea } from 'node:sea';

import { z } from 'zod';

function findWorkspaceRoot(startDirectory: string): string {
    let candidate = resolve(startDirectory);

    while (true) {
        if (
            existsSync(resolve(candidate, 'apps', 'server', 'package.json')) &&
            existsSync(resolve(candidate, 'apps', 'web', 'package.json'))
        ) {
            return candidate;
        }

        const parent = dirname(candidate);

        if (parent === candidate) {
            return resolve(startDirectory);
        }

        candidate = parent;
    }
}

const workingDirectory = process.cwd();
const workspaceRoot =
    process.env.VIDEOSHARE_WORKSPACE_DIR?.trim() ||
    findWorkspaceRoot(workingDirectory);
const detectedRuntimeRoot = isSea() ? workingDirectory : undefined;
const runtimeRoot =
    process.env.VIDEOSHARE_RUNTIME_DIR?.trim() ||
    detectedRuntimeRoot ||
    workspaceRoot;

function getDefaultStoragePath(...segments: string[]): string {
    return resolve(runtimeRoot, 'storage', ...segments);
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
                    .replace(/^['"]|['"]$/g, '');

                return key.length > 0 ? [[key, value]] : [];
            })
    );
}

function getNonEmptyValue(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildLocalUrl(protocol: string, host: string, port: number): string {
    return `${protocol}://${host}:${port}`;
}

function loadFileEnv(): Record<string, string> {
    const explicitEnvFile = process.env.VIDEOSHARE_ENV_FILE?.trim();
    const runtimeDirectory =
        process.env.VIDEOSHARE_RUNTIME_DIR?.trim() || detectedRuntimeRoot;

    const candidates = [
        explicitEnvFile,
        runtimeDirectory ? resolve(runtimeDirectory, '.env') : undefined,
        runtimeDirectory ? resolve(runtimeDirectory, '.env.example') : undefined,
        resolve(workspaceRoot, '.env'),
        resolve(workspaceRoot, '.env.example')
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
        if (!existsSync(candidate)) {
            continue;
        }

        return parseEnvFile(readFileSync(candidate, 'utf8'));
    }

    return {};
}

const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_PROTOCOL: z.string().optional(),
    PUBLIC_HOST: z.string().optional(),
    APP_PROTOCOL: z.string().optional(),
    APP_HOST: z.string().optional(),
    WEB_DEV_PORT: z.coerce.number().int().positive().default(5173),
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
    const parsedEnv = envSchema.parse({
        ...loadFileEnv(),
        ...process.env
    });
    const publicProtocol =
        getNonEmptyValue(parsedEnv.PUBLIC_PROTOCOL) ??
        getNonEmptyValue(parsedEnv.APP_PROTOCOL) ??
        'http';
    const publicHost =
        getNonEmptyValue(parsedEnv.PUBLIC_HOST) ??
        getNonEmptyValue(parsedEnv.APP_HOST) ??
        'localhost';
    const databasePath = resolveDatabasePath(parsedEnv.DATABASE_URL);
    const defaultPublicBaseUrl = buildLocalUrl(
        publicProtocol,
        publicHost,
        parsedEnv.PORT
    );
    const publicBaseUrl =
        getNonEmptyValue(parsedEnv.PUBLIC_BASE_URL) ?? defaultPublicBaseUrl;
    const defaultDevWebUrl = buildLocalUrl(
        publicProtocol,
        publicHost,
        parsedEnv.WEB_DEV_PORT
    );
    const webOrigin =
        getNonEmptyValue(parsedEnv.WEB_URL) ??
        getNonEmptyValue(parsedEnv.WEB_ORIGIN) ??
        (parsedEnv.NODE_ENV === 'production' ? publicBaseUrl : defaultDevWebUrl);

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
                parsedEnv.WEB_DIST_DIR ?? resolve(workspaceRoot, 'apps', 'web', 'dist')
        },
        storage: {
            mediaDir: parsedEnv.MEDIA_INPUT_DIR ?? getDefaultStoragePath('media'),
            hlsDir: parsedEnv.HLS_OUTPUT_DIR ?? getDefaultStoragePath('hls'),
            subtitleDir: parsedEnv.SUBTITLE_DIR ?? getDefaultStoragePath('subtitles'),
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
