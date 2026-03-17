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

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AppEnv } from '../config/env.js';
import type { DatabaseContext } from '../db/database.js';
import type {
  CleanupRunSummary,
  CleanupStatus,
  SystemDiagnostics
} from '../types/models.js';

const RETENTION_NOTICE =
  'HLS artifacts were cleaned up by retention policy. Retry processing to rebuild playback assets.';

type CleanupMediaRow = {
  id: string;
  created_at: string;
  hls_generated_at: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  hls_manifest_path: string | null;
};

type CleanupDependencies = {
  getActiveProcessingJobCount: () => number;
};

export type CleanupService = ReturnType<typeof createCleanupService>;

export function createCleanupService(
  database: DatabaseContext,
  env: AppEnv,
  dependencies: CleanupDependencies
) {
  const listActiveMediaIdsStatement = database.connection.prepare(`
    SELECT DISTINCT active_media_id
    FROM rooms
    WHERE active_media_id IS NOT NULL
      AND status = 'active'
  `);

  const listMediaStatement = database.connection.prepare(`
    SELECT id, created_at, hls_generated_at, status, hls_manifest_path
    FROM media
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

  const listSubtitleFilePathsStatement = database.connection.prepare(`
    SELECT source_path, served_path
    FROM subtitles
  `);

  const countStatements = {
    totalRooms: database.connection.prepare(
      'SELECT COUNT(*) AS count FROM rooms'
    ),
    activeRooms: database.connection.prepare(`
      SELECT COUNT(*) AS count
      FROM rooms
      WHERE status = 'active'
    `),
    totalParticipants: database.connection.prepare(
      'SELECT COUNT(*) AS count FROM participants'
    ),
    connectedParticipants: database.connection.prepare(`
      SELECT COUNT(*) AS count
      FROM participants
      WHERE connection_state = 'connected'
    `),
    totalMedia: database.connection.prepare(
      'SELECT COUNT(*) AS count FROM media'
    ),
    readyMedia: database.connection.prepare(`
      SELECT COUNT(*) AS count
      FROM media
      WHERE status = 'ready'
        AND hls_manifest_path IS NOT NULL
    `),
    totalSubtitles: database.connection.prepare(
      'SELECT COUNT(*) AS count FROM subtitles'
    )
  };

  let lastRun: CleanupRunSummary | null = null;

  function readCount(
    statement: ReturnType<typeof database.connection.prepare>
  ): number {
    const row = statement.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  function removePath(path: string, options?: { recursive?: boolean }) {
    if (!existsSync(path)) {
      return false;
    }

    rmSync(path, {
      force: true,
      recursive: options?.recursive ?? false
    });

    return true;
  }

  function runNow(): CleanupRunSummary {
    const startedAt = new Date().toISOString();
    const nowMs = Date.now();
    const retentionCutoffMs =
      nowMs - env.cleanup.hlsRetentionHours * 60 * 60 * 1000;
    const warnings: string[] = [];

    let expiredRoomsClosed = 0;
    let idleRoomsClosed = 0;
    let hlsDirectoriesRemoved = 0;
    let subtitleFilesRemoved = 0;
    let mediaEvicted = 0;

    const activeMediaIds = new Set(
      (
        listActiveMediaIdsStatement.all() as Array<{
          active_media_id: string | null;
        }>
      )
        .map((row) => row.active_media_id)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
    );

    const mediaRows = listMediaStatement.all() as CleanupMediaRow[];
    const mediaById = new Map(mediaRows.map((row) => [row.id, row]));

    for (const entry of readdirSync(env.storage.hlsDir, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const directoryPath = resolve(env.storage.hlsDir, entry.name);
      const media = mediaById.get(entry.name);

      if (!media) {
        if (removePath(directoryPath, { recursive: true })) {
          hlsDirectoriesRemoved += 1;
        }
        continue;
      }

      if (media.status === 'processing' || activeMediaIds.has(media.id)) {
        continue;
      }

      const retentionReference = media.hls_generated_at ?? media.created_at;
      const retentionReferenceMs = Date.parse(retentionReference);
      const pastRetention =
        Number.isNaN(retentionReferenceMs) ||
        retentionReferenceMs <= retentionCutoffMs;
      const shouldRemoveReadyArtifacts =
        media.status === 'ready' && pastRetention;
      const shouldRemoveStaleArtifacts = media.status !== 'ready';

      if (!shouldRemoveReadyArtifacts && !shouldRemoveStaleArtifacts) {
        continue;
      }

      if (removePath(directoryPath, { recursive: true })) {
        hlsDirectoriesRemoved += 1;
      }

      if (media.status === 'ready' || media.hls_manifest_path) {
        updateMediaStatusStatement.run(
          'error',
          null,
          null,
          RETENTION_NOTICE,
          media.id
        );
        mediaEvicted += 1;
      }
    }

    const knownSubtitlePaths = new Set<string>();
    const subtitleRows = listSubtitleFilePathsStatement.all() as Array<{
      source_path: string;
      served_path: string | null;
    }>;

    for (const subtitle of subtitleRows) {
      knownSubtitlePaths.add(resolve(subtitle.source_path));

      if (subtitle.served_path) {
        knownSubtitlePaths.add(resolve(subtitle.served_path));
      }
    }

    for (const entry of readdirSync(env.storage.subtitleDir, {
      withFileTypes: true
    })) {
      const targetPath = resolve(env.storage.subtitleDir, entry.name);

      if (knownSubtitlePaths.has(targetPath)) {
        continue;
      }

      if (removePath(targetPath, { recursive: entry.isDirectory() })) {
        subtitleFilesRemoved += 1;
      }
    }

    lastRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      expiredRoomsClosed,
      idleRoomsClosed,
      hlsDirectoriesRemoved,
      subtitleFilesRemoved,
      mediaEvicted,
      warnings
    };

    return lastRun;
  }

  return {
    runNow,

    getStatus(): CleanupStatus {
      return {
        enabled: true,
        intervalMinutes: env.cleanup.intervalMinutes,
        idleRoomTtlMinutes: env.cleanup.idleRoomTtlMinutes,
        hlsRetentionHours: env.cleanup.hlsRetentionHours,
        lastRun
      };
    },

    getDiagnostics(): SystemDiagnostics {
      return {
        totalRooms: readCount(countStatements.totalRooms),
        activeRooms: readCount(countStatements.activeRooms),
        totalParticipants: readCount(countStatements.totalParticipants),
        connectedParticipants: readCount(countStatements.connectedParticipants),
        totalMedia: readCount(countStatements.totalMedia),
        readyMedia: readCount(countStatements.readyMedia),
        totalSubtitles: readCount(countStatements.totalSubtitles),
        activeProcessingJobs: dependencies.getActiveProcessingJobCount()
      };
    }
  };
}
