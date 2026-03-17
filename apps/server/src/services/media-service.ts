import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { AppEnv } from '../config/env.js';
import type { DatabaseContext } from '../db/database.js';
import { HttpError } from '../lib/errors.js';
import type {
  Media,
  MediaListResponse,
  MediaOperationResponse,
  Subtitle,
  SubtitleOperationResponse
} from '../types/models.js';

type MediaRow = {
  id: string;
  original_file_name: string;
  source_path: string;
  duration_ms: number | null;
  container: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  hls_manifest_path: string | null;
  hls_generated_at: string | null;
  processing_error: string | null;
  status: Media['status'];
  created_at: string;
};

type SubtitleRow = {
  id: string;
  media_id: string;
  label: string;
  language: string | null;
  format: Subtitle['format'];
  source_path: string;
  served_path: string | null;
  is_default: number;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
};

type ProbeFormat = {
  duration?: string;
  format_name?: string;
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: ProbeFormat;
};

const supportedSubtitleExtensions = new Set(['.srt', '.vtt', '.ass']);
const HLS_SEGMENT_DURATION_SECONDS = 4;
const HLS_MAX_VIDEO_BITRATE = '4500k';
const HLS_BUFFER_SIZE = '9000k';

function mapMedia(row: MediaRow): Media {
  return {
    id: row.id,
    originalFileName: row.original_file_name,
    sourcePath: row.source_path,
    durationMs: row.duration_ms,
    container: row.container,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    width: row.width,
    height: row.height,
    hlsManifestPath: row.hls_manifest_path,
    processingError: row.processing_error,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapSubtitle(row: SubtitleRow): Subtitle {
  return {
    id: row.id,
    mediaId: row.media_id,
    label: row.label,
    language: row.language,
    format: row.format,
    sourcePath: row.source_path,
    servedPath: row.served_path,
    isDefault: row.is_default === 1
  };
}

function sanitizeFileName(fileName: string): string {
  const baseName = basename(fileName).trim();
  const extension = extname(baseName)
    .slice(0, 16)
    .replace(/[^.\w-]/g, '');
  const nameWithoutExtension = baseName.slice(
    0,
    baseName.length - extname(baseName).length
  );
  const sanitizedName = nameWithoutExtension
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);

  return `${sanitizedName || 'media'}${extension}`;
}

function toProcessingErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message;
  }

  if (error instanceof Error) {
    const maybeErrno = error as Error & { code?: string };

    if (maybeErrno.code === 'ENOENT') {
      return 'FFmpeg or ffprobe could not be started. Check the configured binary paths on the host machine.';
    }

    return error.message;
  }

  return 'Unexpected media processing error';
}

function buildUrlFromBase(baseUrl: string, relativePath: string): string {
  const normalizedBase = new URL(baseUrl);
  const normalizedPath = normalizedBase.pathname.endsWith('/')
    ? normalizedBase.pathname
    : `${normalizedBase.pathname}/`;
  const sanitizedRelativePath = relativePath.replace(/^\/+/, '');

  normalizedBase.pathname = `${normalizedPath}${sanitizedRelativePath}`;
  normalizedBase.search = '';
  normalizedBase.hash = '';

  return normalizedBase.toString();
}

function createPlayerUrl(
  webOrigin: string,
  mediaId: string,
  roomToken?: string
): string {
  const playerUrl = new URL(buildUrlFromBase(webOrigin, ''));
  playerUrl.searchParams.set('mediaId', mediaId);

  if (roomToken) {
    playerUrl.searchParams.set('roomToken', roomToken);
  }

  return playerUrl.toString();
}

function createManifestUrl(
  publicBaseUrl: string,
  media: Pick<Media, 'id' | 'hlsManifestPath'>
): string | null {
  if (!media.hlsManifestPath) {
    return null;
  }

  return buildUrlFromBase(
    publicBaseUrl,
    `media/${media.id}/${media.hlsManifestPath}`
  );
}

function createSubtitleUrl(publicBaseUrl: string, subtitleId: string): string {
  return buildUrlFromBase(publicBaseUrl, `subtitles/${subtitleId}.vtt`);
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectCommand(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolveCommand(stdout);
        return;
      }

      rejectCommand(
        new Error(stderr.trim() || `${command} exited with code ${code ?? 1}`)
      );
    });
  });
}

function getSubtitleFormat(fileName: string): Subtitle['format'] {
  const extension = extname(fileName).toLowerCase();

  if (!supportedSubtitleExtensions.has(extension)) {
    throw new HttpError(
      415,
      'Unsupported subtitle file. Expected .srt, .vtt, or .ass'
    );
  }

  return extension.slice(1) as Subtitle['format'];
}

function createSubtitleLabel(fileName: string): string {
  const cleanName = basename(fileName, extname(fileName)).trim();
  return cleanName.length > 0 ? cleanName : 'Subtitle track';
}

function removePathOrThrow(path: string, options?: { recursive?: boolean }) {
  const existedBefore = existsSync(path);

  rmSync(path, {
    force: true,
    recursive: options?.recursive ?? false
  });

  if (existedBefore && existsSync(path)) {
    throw new HttpError(500, `Failed to remove storage path: ${path}`);
  }
}

export type MediaService = ReturnType<typeof createMediaService>;

export function createMediaService(database: DatabaseContext, env: AppEnv) {
  const activeProcessingJobs = new Map<string, Promise<void>>();
  const getMediaStatement = database.connection.prepare(`
    SELECT
      id,
      original_file_name,
      source_path,
      duration_ms,
      container,
      video_codec,
      audio_codec,
      width,
      height,
      hls_manifest_path,
      hls_generated_at,
      processing_error,
      status,
      created_at
    FROM media
    WHERE id = ?
  `);

  const listMediaStatement = database.connection.prepare(`
    SELECT
      id,
      original_file_name,
      source_path,
      duration_ms,
      container,
      video_codec,
      audio_codec,
      width,
      height,
      hls_manifest_path,
      hls_generated_at,
      processing_error,
      status,
      created_at
    FROM media
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const listSubtitlesForMediaStatement = database.connection.prepare(`
    SELECT
      id,
      media_id,
      label,
      language,
      format,
      source_path,
      served_path,
      is_default
    FROM subtitles
    WHERE media_id = ?
    ORDER BY is_default DESC, label ASC
  `);

  const getSubtitleStatement = database.connection.prepare(`
    SELECT
      id,
      media_id,
      label,
      language,
      format,
      source_path,
      served_path,
      is_default
    FROM subtitles
    WHERE id = ?
  `);

  const insertMediaStatement = database.connection.prepare(`
    INSERT INTO media (
      id,
      original_file_name,
      source_path,
      duration_ms,
      container,
      video_codec,
      audio_codec,
      width,
      height,
      hls_manifest_path,
      hls_generated_at,
      processing_error,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSubtitleStatement = database.connection.prepare(`
    INSERT INTO subtitles (
      id,
      media_id,
      label,
      language,
      format,
      source_path,
      served_path,
      is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateMediaMetadataStatement = database.connection.prepare(`
    UPDATE media
    SET
      duration_ms = ?,
      container = ?,
      video_codec = ?,
      audio_codec = ?,
      width = ?,
      height = ?
    WHERE id = ?
  `);

  const updateMediaStatusStatement = database.connection.prepare(`
    UPDATE media
    SET
      status = ?,
      hls_manifest_path = ?,
      hls_generated_at = ?,
      processing_error = ?
    WHERE id = ?
  `);

  const deleteMediaStatement = database.connection.prepare(`
    DELETE FROM media
    WHERE id = ?
  `);

  async function probeMedia(media: Media) {
    const output = await runCommand(env.mediaProcessing.ffprobePath, [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-print_format',
      'json',
      media.sourcePath
    ]);

    const probe = JSON.parse(output) as ProbeResult;
    const streams = probe.streams ?? [];
    const videoStream = streams.find((stream) => stream.codec_type === 'video');
    const audioStream = streams.find((stream) => stream.codec_type === 'audio');
    const durationMs =
      probe.format?.duration && Number.isFinite(Number(probe.format.duration))
        ? Math.round(Number(probe.format.duration) * 1000)
        : null;

    if (!videoStream) {
      throw new HttpError(415, 'Unsupported media file: no video stream found');
    }

    updateMediaMetadataStatement.run(
      durationMs,
      probe.format?.format_name ?? null,
      videoStream.codec_name ?? null,
      audioStream?.codec_name ?? null,
      videoStream.width ?? null,
      videoStream.height ?? null,
      media.id
    );
  }

  async function processMediaRecord(mediaId: string) {
    const media = service.getMediaById(mediaId);

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    updateMediaStatusStatement.run('processing', null, null, null, mediaId);

    try {
      await probeMedia(media);

      const outputDirectory = resolve(env.storage.hlsDir, mediaId);
      rmSync(outputDirectory, {
        recursive: true,
        force: true
      });
      mkdirSync(outputDirectory, { recursive: true });

      await runCommand(env.mediaProcessing.ffmpegPath, [
        '-y',
        '-i',
        media.sourcePath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '21',
        '-maxrate',
        HLS_MAX_VIDEO_BITRATE,
        '-bufsize',
        HLS_BUFFER_SIZE,
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-sc_threshold',
        '0',
        '-force_key_frames',
        `expr:gte(t,n_forced*${HLS_SEGMENT_DURATION_SECONDS})`,
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-ac',
        '2',
        '-sn',
        '-f',
        'hls',
        '-hls_time',
        String(HLS_SEGMENT_DURATION_SECONDS),
        '-hls_list_size',
        '0',
        '-hls_playlist_type',
        'vod',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        resolve(outputDirectory, 'segment-%03d.ts'),
        resolve(outputDirectory, 'master.m3u8')
      ]);

      updateMediaStatusStatement.run(
        'ready',
        'master.m3u8',
        new Date().toISOString(),
        null,
        mediaId
      );
    } catch (error) {
      updateMediaStatusStatement.run(
        'error',
        null,
        null,
        toProcessingErrorMessage(error),
        mediaId
      );
    }
  }

  async function convertSubtitleToVtt(sourcePath: string, targetPath: string) {
    await runCommand(env.mediaProcessing.ffmpegPath, [
      '-y',
      '-i',
      sourcePath,
      '-f',
      'webvtt',
      targetPath
    ]);
  }

  function buildOperationResponse(
    media: Media,
    processingQueued: boolean
  ): MediaOperationResponse {
    return {
      media,
      manifestUrl: createManifestUrl(env.publicBaseUrl, media),
      playerUrl: createPlayerUrl(env.webOrigin, media.id),
      processingQueued
    };
  }

  function requireDeletableMedia(mediaId: string): Media {
    const media = service.getMediaById(mediaId);

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    if (activeProcessingJobs.has(mediaId)) {
      throw new HttpError(
        409,
        'Cannot delete media while processing is active'
      );
    }

    return media;
  }
  const service = {
    listRecentMedia(limit = 12): MediaListResponse {
      const rows = listMediaStatement.all(limit) as MediaRow[];

      return {
        media: rows.map((row) => mapMedia(row))
      };
    },

    getMediaById(mediaId: string): Media | null {
      const row = getMediaStatement.get(mediaId) as MediaRow | undefined;

      return row ? mapMedia(row) : null;
    },

    getSubtitleById(subtitleId: string): Subtitle | null {
      const row = getSubtitleStatement.get(subtitleId) as
        | SubtitleRow
        | undefined;

      return row ? mapSubtitle(row) : null;
    },

    listSubtitlesByMediaId(mediaId: string): Subtitle[] {
      const rows = listSubtitlesForMediaStatement.all(mediaId) as SubtitleRow[];

      return rows.map((row) => mapSubtitle(row));
    },

    async importUploadedMedia(input: {
      fileName: string;
      stream: Readable;
      autoProcess?: boolean;
    }): Promise<MediaOperationResponse> {
      const mediaId = randomUUID();
      const sanitizedFileName = sanitizeFileName(input.fileName);
      const storedFilePath = resolve(
        env.storage.mediaDir,
        `${mediaId}-${sanitizedFileName}`
      );
      const createdAt = new Date().toISOString();

      try {
        await pipeline(input.stream, createWriteStream(storedFilePath));
      } catch (error) {
        rmSync(storedFilePath, { force: true });
        throw error;
      }

      insertMediaStatement.run(
        mediaId,
        sanitizedFileName,
        storedFilePath,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'pending',
        createdAt
      );

      const media = service.getMediaById(mediaId);

      if (!media) {
        throw new HttpError(
          500,
          'Media import completed but record was missing'
        );
      }

      const processingQueued =
        input.autoProcess === false ? false : service.startProcessing(mediaId);
      const latestMedia = service.getMediaById(mediaId) ?? media;

      return buildOperationResponse(latestMedia, processingQueued);
    },

    async importSubtitleForMedia(input: {
      mediaId: string;
      fileName: string;
      stream: Readable;
      language?: string | null;
      label?: string | null;
      isDefault?: boolean;
    }): Promise<SubtitleOperationResponse> {
      const media = service.getMediaById(input.mediaId);

      if (!media) {
        throw new HttpError(404, 'Media not found');
      }

      const subtitleId = randomUUID();
      const sanitizedFileName = sanitizeFileName(input.fileName);
      const originalFormat = getSubtitleFormat(sanitizedFileName);
      const sourcePath = resolve(
        env.storage.subtitleDir,
        `${subtitleId}-source${extname(sanitizedFileName).toLowerCase()}`
      );
      const servedPath = resolve(env.storage.subtitleDir, `${subtitleId}.vtt`);

      try {
        await pipeline(input.stream, createWriteStream(sourcePath));

        if (originalFormat === 'vtt') {
          await pipeline(
            createReadStream(sourcePath),
            createWriteStream(servedPath)
          );
        } else {
          await convertSubtitleToVtt(sourcePath, servedPath);
        }
      } catch (error) {
        rmSync(sourcePath, { force: true });
        rmSync(servedPath, { force: true });
        throw new HttpError(
          422,
          `Subtitle import failed: ${toProcessingErrorMessage(error)}`
        );
      }

      insertSubtitleStatement.run(
        subtitleId,
        media.id,
        input.label?.trim() || createSubtitleLabel(sanitizedFileName),
        input.language?.trim() || null,
        originalFormat,
        sourcePath,
        servedPath,
        input.isDefault ? 1 : 0
      );

      const subtitle = service.getSubtitleById(subtitleId);

      if (!subtitle) {
        throw new HttpError(
          500,
          'Subtitle import completed but record was missing'
        );
      }

      return {
        subtitle,
        subtitleUrl: createSubtitleUrl(env.publicBaseUrl, subtitle.id)
      };
    },

    startProcessing(mediaId: string): boolean {
      if (activeProcessingJobs.has(mediaId)) {
        return false;
      }

      const processingJob = processMediaRecord(mediaId).finally(() => {
        activeProcessingJobs.delete(mediaId);
      });

      activeProcessingJobs.set(mediaId, processingJob);

      return true;
    },

    requestProcessing(mediaId: string): MediaOperationResponse {
      const media = service.getMediaById(mediaId);

      if (!media) {
        throw new HttpError(404, 'Media not found');
      }

      const processingQueued = service.startProcessing(mediaId);
      const latestMedia = service.getMediaById(mediaId) ?? media;

      return buildOperationResponse(latestMedia, processingQueued);
    },

    ensureMediaCanBeDeleted(mediaId: string): void {
      requireDeletableMedia(mediaId);
    },

    deleteMedia(mediaId: string): void {
      const media = requireDeletableMedia(mediaId);
      const subtitles = service.listSubtitlesByMediaId(mediaId);

      removePathOrThrow(media.sourcePath);
      removePathOrThrow(resolve(env.storage.hlsDir, mediaId), {
        recursive: true
      });

      for (const subtitle of subtitles) {
        removePathOrThrow(subtitle.sourcePath);

        if (subtitle.servedPath) {
          removePathOrThrow(subtitle.servedPath);
        }
      }

      const result = deleteMediaStatement.run(mediaId);

      if (result.changes === 0) {
        throw new HttpError(404, 'Media not found');
      }
    },

    getActiveProcessingJobCount(): number {
      return activeProcessingJobs.size;
    },

    buildPlayerUrl(mediaId: string, roomToken?: string): string {
      return createPlayerUrl(env.webOrigin, mediaId, roomToken);
    },

    buildSubtitleUrl(subtitleId: string): string {
      return createSubtitleUrl(env.publicBaseUrl, subtitleId);
    }
  };

  return service;
}
