import { randomBytes, randomUUID } from 'node:crypto';

import type { DatabaseContext } from '../db/database.js';
import type { AppEnv } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import type { MediaService } from './media-service.js';

import type {
  CreateRoomRequest,
  Room,
  RoomLookupResponse
} from '../types/models.js';

type RoomRow = {
  id: string;
  token: string;
  created_at: string;
  expires_at: string | null;
  status: Room['status'];
  host_client_id: string | null;
  current_playback_time: number;
  playback_state: Room['playbackState'];
  playback_rate: number;
  last_state_updated_at: string;
  active_media_id: string | null;
  active_subtitle_id: string | null;
};

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    hostClientId: row.host_client_id,
    currentPlaybackTime: row.current_playback_time,
    playbackState: row.playback_state,
    playbackRate: row.playback_rate,
    lastStateUpdatedAt: row.last_state_updated_at,
    activeMediaId: row.active_media_id,
    activeSubtitleId: row.active_subtitle_id
  };
}

function createRoomShareUrl(publicBaseUrl: string, token: string): string {
  return new URL(`/room/${token}`, publicBaseUrl).toString();
}

export type RoomService = ReturnType<typeof createRoomService>;

export function createRoomService(
  database: DatabaseContext,
  mediaService: MediaService,
  env: AppEnv
) {
  const insertRoomStatement = database.connection.prepare(`
    INSERT INTO rooms (
      id,
      token,
      created_at,
      expires_at,
      status,
      host_client_id,
      current_playback_time,
      playback_state,
      playback_rate,
      last_state_updated_at,
      active_media_id,
      active_subtitle_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getRoomByTokenStatement = database.connection.prepare(`
    SELECT
      id,
      token,
      created_at,
      expires_at,
      status,
      host_client_id,
      current_playback_time,
      playback_state,
      playback_rate,
      last_state_updated_at,
      active_media_id,
      active_subtitle_id
    FROM rooms
    WHERE token = ?
  `);

  const closeRoomStatement = database.connection.prepare(`
    UPDATE rooms
    SET status = 'closed'
    WHERE token = ?
  `);

  function buildRoomLookupResponse(room: Room): RoomLookupResponse {
    const media = room.activeMediaId
      ? mediaService.getMediaById(room.activeMediaId)
      : null;
    const subtitles = room.activeMediaId
      ? mediaService.listSubtitlesByMediaId(room.activeMediaId)
      : [];

    return {
      room,
      media,
      subtitles,
      shareUrl: createRoomShareUrl(env.publicBaseUrl, room.token),
      socketPath: env.realtime.path
    };
  }

  return {
    createRoom(input: CreateRoomRequest): RoomLookupResponse {
      const now = new Date().toISOString();
      const room: Room = {
        id: randomUUID(),
        token: randomBytes(env.roomTokenBytes).toString('base64url'),
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
        status: 'active',
        hostClientId: input.hostClientId ?? null,
        currentPlaybackTime: 0,
        playbackState: 'paused',
        playbackRate: 1,
        lastStateUpdatedAt: now,
        activeMediaId: input.activeMediaId ?? null,
        activeSubtitleId: input.activeSubtitleId ?? null
      };

      insertRoomStatement.run(
        room.id,
        room.token,
        room.createdAt,
        room.expiresAt,
        room.status,
        room.hostClientId,
        room.currentPlaybackTime,
        room.playbackState,
        room.playbackRate,
        room.lastStateUpdatedAt,
        room.activeMediaId,
        room.activeSubtitleId
      );

      return buildRoomLookupResponse(room);
    },

    getRoomByToken(token: string): RoomLookupResponse {
      const row = getRoomByTokenStatement.get(token) as RoomRow | undefined;

      if (!row) {
        throw new HttpError(404, 'Room not found');
      }

      const room = mapRoom(row);

      if (room.expiresAt && new Date(room.expiresAt).getTime() <= Date.now()) {
        throw new HttpError(410, 'Room expired');
      }

      if (room.status === 'closed') {
        throw new HttpError(410, 'Room closed');
      }

      return buildRoomLookupResponse(room);
    },

    closeRoom(token: string): void {
      const result = closeRoomStatement.run(token);

      if (result.changes === 0) {
        throw new HttpError(404, 'Room not found');
      }
    }
  };
}
