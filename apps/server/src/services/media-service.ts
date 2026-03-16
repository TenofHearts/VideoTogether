import type { DatabaseContext } from '../db/database.js';

import type { Media, Subtitle } from '../types/models.js';

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

export type MediaService = ReturnType<typeof createMediaService>;

export function createMediaService(database: DatabaseContext) {
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
      status,
      created_at
    FROM media
    WHERE id = ?
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

  return {
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
    }
  };
}

