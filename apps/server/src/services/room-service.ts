import { randomBytes, randomUUID } from 'node:crypto';

import type { AppEnv } from '../config/env.js';
import type { DatabaseContext } from '../db/database.js';
import { HttpError } from '../lib/errors.js';
import type { MediaService } from './media-service.js';

import type {
  CreateRoomRequest,
  JoinRoomRequest,
  Participant,
  PlaybackCommandPayload,
  PlaybackResyncMode,
  PlaybackStateReportPayload,
  Room,
  RoomJoinResponse,
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

type ParticipantRow = {
  id: string;
  room_id: string;
  display_name: string;
  role: Participant['role'];
  joined_at: string;
  last_seen_at: string;
  socket_id: string | null;
  connection_state: Participant['connectionState'];
};

type PlaybackMutationKind = 'play' | 'pause' | 'seek';

type PlaybackMutationResult = {
  roomToken: string;
  participant: Participant;
  room: Room;
  response: RoomLookupResponse;
};

type PlaybackDriftResult = {
  roomToken: string;
  participant: Participant;
  room: Room;
  driftMs: number;
  shouldResync: boolean;
  mode: PlaybackResyncMode | null;
};

const HARD_RESYNC_THRESHOLD_MS = 1500;
const SOFT_RESYNC_THRESHOLD_MS = 500;
const PAUSED_RESYNC_THRESHOLD_MS = 250;

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

function mapParticipant(row: ParticipantRow): Participant {
  return {
    id: row.id,
    roomId: row.room_id,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    socketId: row.socket_id,
    connectionState: row.connection_state
  };
}

function createRoomShareUrl(publicBaseUrl: string, token: string): string {
  return new URL(`/room/${token}`, publicBaseUrl).toString();
}

function normalizeDisplayName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 48);
}

function roundPlaybackTime(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000;
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

  const getRoomByIdStatement = database.connection.prepare(`
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
    WHERE id = ?
  `);

  const updateRoomStatusStatement = database.connection.prepare(`
    UPDATE rooms
    SET status = ?
    WHERE token = ?
  `);

  const updateRoomSubtitleStatement = database.connection.prepare(`
    UPDATE rooms
    SET active_subtitle_id = ?
    WHERE token = ?
  `);

  const updateRoomHostStatement = database.connection.prepare(`
    UPDATE rooms
    SET host_client_id = ?
    WHERE id = ?
  `);

  const updateRoomPlaybackStatement = database.connection.prepare(`
    UPDATE rooms
    SET
      current_playback_time = ?,
      playback_state = ?,
      playback_rate = ?,
      last_state_updated_at = ?
    WHERE id = ?
  `);

  const listParticipantsByRoomIdStatement = database.connection.prepare(`
    SELECT
      id,
      room_id,
      display_name,
      role,
      joined_at,
      last_seen_at,
      socket_id,
      connection_state
    FROM participants
    WHERE room_id = ?
    ORDER BY CASE role WHEN 'host' THEN 0 ELSE 1 END, joined_at ASC
  `);

  const getParticipantByIdStatement = database.connection.prepare(`
    SELECT
      id,
      room_id,
      display_name,
      role,
      joined_at,
      last_seen_at,
      socket_id,
      connection_state
    FROM participants
    WHERE id = ?
  `);

  const getParticipantBySocketIdStatement = database.connection.prepare(`
    SELECT
      id,
      room_id,
      display_name,
      role,
      joined_at,
      last_seen_at,
      socket_id,
      connection_state
    FROM participants
    WHERE socket_id = ?
  `);

  const insertParticipantStatement = database.connection.prepare(`
    INSERT INTO participants (
      id,
      room_id,
      display_name,
      role,
      joined_at,
      last_seen_at,
      socket_id,
      connection_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const refreshParticipantStatement = database.connection.prepare(`
    UPDATE participants
    SET
      display_name = ?,
      last_seen_at = ?,
      socket_id = NULL,
      connection_state = 'disconnected'
    WHERE id = ?
  `);

  const connectParticipantStatement = database.connection.prepare(`
    UPDATE participants
    SET
      last_seen_at = ?,
      socket_id = ?,
      connection_state = 'connected'
    WHERE id = ?
  `);

  const disconnectParticipantStatement = database.connection.prepare(`
    UPDATE participants
    SET
      last_seen_at = ?,
      socket_id = NULL,
      connection_state = 'disconnected'
    WHERE id = ?
  `);

  const disconnectParticipantsByRoomIdStatement = database.connection.prepare(`
    UPDATE participants
    SET
      last_seen_at = ?,
      socket_id = NULL,
      connection_state = 'disconnected'
    WHERE room_id = ?
  `);

  const touchParticipantStatement = database.connection.prepare(`
    UPDATE participants
    SET last_seen_at = ?
    WHERE id = ?
  `);

  function listParticipantsByRoomId(roomId: string): Participant[] {
    const rows = listParticipantsByRoomIdStatement.all(roomId) as ParticipantRow[];
    return rows.map((row) => mapParticipant(row));
  }

  function getRoomByTokenRecord(token: string): Room | null {
    const row = getRoomByTokenStatement.get(token) as RoomRow | undefined;
    return row ? mapRoom(row) : null;
  }

  function getRoomByIdRecord(roomId: string): Room | null {
    const row = getRoomByIdStatement.get(roomId) as RoomRow | undefined;
    return row ? mapRoom(row) : null;
  }

  function getParticipantById(participantId: string): Participant | null {
    const row = getParticipantByIdStatement.get(participantId) as ParticipantRow | undefined;
    return row ? mapParticipant(row) : null;
  }

  function getRoomDurationSeconds(room: Room): number | null {
    if (!room.activeMediaId) {
      return null;
    }

    const media = mediaService.getMediaById(room.activeMediaId);

    if (!media?.durationMs || media.durationMs <= 0) {
      return null;
    }

    return media.durationMs / 1000;
  }

  function clampPlaybackTime(value: number, durationSeconds: number | null): number {
    const roundedTime = roundPlaybackTime(value);

    if (durationSeconds === null) {
      return roundedTime;
    }

    return Math.min(roundedTime, roundPlaybackTime(durationSeconds));
  }

  function getCanonicalPlaybackTime(room: Room, nowMs = Date.now()): number {
    const durationSeconds = getRoomDurationSeconds(room);

    if (room.playbackState !== 'playing') {
      return clampPlaybackTime(room.currentPlaybackTime, durationSeconds);
    }

    const updatedAtMs = Date.parse(room.lastStateUpdatedAt);
    const elapsedSeconds = Number.isNaN(updatedAtMs)
      ? 0
      : Math.max(0, nowMs - updatedAtMs) / 1000;

    return clampPlaybackTime(
      room.currentPlaybackTime + elapsedSeconds * room.playbackRate,
      durationSeconds
    );
  }

  function normalizePlaybackState(
    playbackState: Room['playbackState'],
    currentPlaybackTime: number,
    durationSeconds: number | null
  ): Room['playbackState'] {
    if (durationSeconds !== null && currentPlaybackTime >= roundPlaybackTime(durationSeconds)) {
      return 'paused';
    }

    return playbackState;
  }

  function persistPlaybackState(
    room: Room,
    input: {
      currentPlaybackTime: number;
      playbackState: Room['playbackState'];
      playbackRate: number;
      lastStateUpdatedAt: string;
    }
  ): Room {
    const durationSeconds = getRoomDurationSeconds(room);
    const currentPlaybackTime = clampPlaybackTime(input.currentPlaybackTime, durationSeconds);
    const playbackState = normalizePlaybackState(
      input.playbackState,
      currentPlaybackTime,
      durationSeconds
    );
    const playbackRate = input.playbackRate > 0 ? input.playbackRate : 1;

    updateRoomPlaybackStatement.run(
      currentPlaybackTime,
      playbackState,
      playbackRate,
      input.lastStateUpdatedAt,
      room.id
    );

    return {
      ...room,
      currentPlaybackTime,
      playbackState,
      playbackRate,
      lastStateUpdatedAt: input.lastStateUpdatedAt
    };
  }

  function requireReadyMediaForPlayback(room: Room) {
    if (!room.activeMediaId) {
      throw new HttpError(409, 'Room has no active media');
    }

    const media = mediaService.getMediaById(room.activeMediaId);

    if (!media) {
      throw new HttpError(404, 'Room media not found');
    }

    if (media.status !== 'ready' || !media.hlsManifestPath) {
      throw new HttpError(409, 'Room media is not ready for synchronized playback');
    }

    return media;
  }

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
      participants: listParticipantsByRoomId(room.id),
      shareUrl: createRoomShareUrl(env.publicBaseUrl, room.token),
      socketPath: env.realtime.path
    };
  }

  function getValidatedRoom(token: string): Room {
    const room = getRoomByTokenRecord(token);

    if (!room) {
      throw new HttpError(404, 'Room not found');
    }

    if (room.expiresAt && new Date(room.expiresAt).getTime() <= Date.now()) {
      if (room.status !== 'expired') {
        updateRoomStatusStatement.run('expired', token);
      }

      throw new HttpError(410, 'Room expired');
    }

    if (room.status === 'closed') {
      throw new HttpError(410, 'Room closed');
    }

    if (room.status === 'expired') {
      throw new HttpError(410, 'Room expired');
    }

    return room;
  }

  function createParticipantRecord(input: {
    roomId: string;
    displayName: string;
    role: Participant['role'];
    now: string;
  }): Participant {
    const participant: Participant = {
      id: randomUUID(),
      roomId: input.roomId,
      displayName: input.displayName,
      role: input.role,
      joinedAt: input.now,
      lastSeenAt: input.now,
      socketId: null,
      connectionState: 'disconnected'
    };

    insertParticipantStatement.run(
      participant.id,
      participant.roomId,
      participant.displayName,
      participant.role,
      participant.joinedAt,
      participant.lastSeenAt,
      participant.socketId,
      participant.connectionState
    );

    return participant;
  }

  function requireParticipantForRoom(participantId: string, roomId: string): Participant {
    const participant = getParticipantById(participantId);

    if (!participant || participant.roomId !== roomId) {
      throw new HttpError(403, 'Participant session is not valid for this room');
    }

    return participant;
  }

  function updatePlayback(
    token: string,
    participantId: string,
    input: PlaybackCommandPayload,
    kind: PlaybackMutationKind
  ): PlaybackMutationResult {
    const room = getValidatedRoom(token);
    const participant = requireParticipantForRoom(participantId, room.id);

    requireReadyMediaForPlayback(room);

    const now = new Date().toISOString();
    const playbackRate = input.playbackRate && input.playbackRate > 0
      ? input.playbackRate
      : room.playbackRate;
    const updatedRoom = persistPlaybackState(room, {
      currentPlaybackTime: input.currentTime,
      playbackState:
        kind === 'play'
          ? 'playing'
          : kind === 'pause'
            ? 'paused'
            : room.playbackState,
      playbackRate,
      lastStateUpdatedAt: now
    });

    return {
      roomToken: room.token,
      participant,
      room: updatedRoom,
      response: buildRoomLookupResponse(updatedRoom)
    };
  }

  return {
    createRoom(input: CreateRoomRequest): RoomLookupResponse {
      const now = new Date().toISOString();

      if (input.activeMediaId && !mediaService.getMediaById(input.activeMediaId)) {
        throw new HttpError(404, 'Active media not found');
      }

      if (input.activeSubtitleId) {
        const subtitle = mediaService.getSubtitleById(input.activeSubtitleId);

        if (!subtitle) {
          throw new HttpError(404, 'Active subtitle not found');
        }

        if (input.activeMediaId && subtitle.mediaId !== input.activeMediaId) {
          throw new HttpError(400, 'Active subtitle does not belong to the selected media');
        }
      }

      const room: Room = {
        id: randomUUID(),
        token: randomBytes(env.roomTokenBytes).toString('base64url'),
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
        status: 'active',
        hostClientId: null,
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

      const hostParticipant = createParticipantRecord({
        roomId: room.id,
        displayName: normalizeDisplayName(input.hostDisplayName, 'Host'),
        role: 'host',
        now
      });
      updateRoomHostStatement.run(hostParticipant.id, room.id);

      return buildRoomLookupResponse({
        ...room,
        hostClientId: hostParticipant.id
      });
    },

    getRoomByToken(token: string): RoomLookupResponse {
      return buildRoomLookupResponse(getValidatedRoom(token));
    },

    joinRoom(token: string, input: JoinRoomRequest): RoomJoinResponse {
      const room = getValidatedRoom(token);
      const displayName = normalizeDisplayName(input.displayName, 'Guest');
      const now = new Date().toISOString();

      if (input.participantId) {
        const existingParticipant = requireParticipantForRoom(input.participantId, room.id);
        refreshParticipantStatement.run(displayName, now, existingParticipant.id);

        const participant = getParticipantById(existingParticipant.id) ?? {
          ...existingParticipant,
          displayName,
          lastSeenAt: now,
          socketId: null,
          connectionState: 'disconnected'
        };

        return {
          ...buildRoomLookupResponse(room),
          participant
        };
      }

      const participants = listParticipantsByRoomId(room.id);
      const guestParticipants = participants.filter((participant) => participant.role === 'guest');

      if (guestParticipants.length === 0) {
        const participant = createParticipantRecord({
          roomId: room.id,
          displayName,
          role: 'guest',
          now
        });

        return {
          ...buildRoomLookupResponse(room),
          participant
        };
      }

      if (guestParticipants.length === 1 && guestParticipants[0].connectionState === 'disconnected') {
        const reusableParticipant = guestParticipants[0];
        refreshParticipantStatement.run(displayName, now, reusableParticipant.id);

        const participant = getParticipantById(reusableParticipant.id) ?? {
          ...reusableParticipant,
          displayName,
          lastSeenAt: now,
          socketId: null,
          connectionState: 'disconnected'
        };

        return {
          ...buildRoomLookupResponse(room),
          participant
        };
      }

      throw new HttpError(409, 'Room already has an active guest participant');
    },

    updateActiveSubtitle(token: string, activeSubtitleId: string | null): RoomLookupResponse {
      const room = getValidatedRoom(token);

      if (!room.activeMediaId) {
        throw new HttpError(400, 'Room has no active media');
      }

      if (activeSubtitleId) {
        const subtitle = mediaService.getSubtitleById(activeSubtitleId);

        if (!subtitle) {
          throw new HttpError(404, 'Subtitle not found');
        }

        if (subtitle.mediaId !== room.activeMediaId) {
          throw new HttpError(400, 'Subtitle does not belong to the room media');
        }
      }

      updateRoomSubtitleStatement.run(activeSubtitleId, token);

      return buildRoomLookupResponse({
        ...room,
        activeSubtitleId
      });
    },

    connectParticipant(token: string, participantId: string, socketId: string) {
      const room = getValidatedRoom(token);
      const participant = requireParticipantForRoom(participantId, room.id);
      const now = new Date().toISOString();

      connectParticipantStatement.run(now, socketId, participant.id);

      return {
        roomToken: room.token,
        participant: getParticipantById(participant.id) ?? {
          ...participant,
          socketId,
          lastSeenAt: now,
          connectionState: 'connected'
        },
        response: buildRoomLookupResponse(room)
      };
    },

    touchParticipant(token: string, participantId: string): Participant {
      const room = getValidatedRoom(token);
      const participant = requireParticipantForRoom(participantId, room.id);
      const now = new Date().toISOString();

      touchParticipantStatement.run(now, participant.id);

      return getParticipantById(participant.id) ?? {
        ...participant,
        lastSeenAt: now
      };
    },

    play(token: string, participantId: string, input: PlaybackCommandPayload): PlaybackMutationResult {
      return updatePlayback(token, participantId, input, 'play');
    },

    pause(token: string, participantId: string, input: PlaybackCommandPayload): PlaybackMutationResult {
      return updatePlayback(token, participantId, input, 'pause');
    },

    seek(token: string, participantId: string, input: PlaybackCommandPayload): PlaybackMutationResult {
      return updatePlayback(token, participantId, input, 'seek');
    },

    reportPlaybackState(
      token: string,
      participantId: string,
      input: PlaybackStateReportPayload
    ): PlaybackDriftResult {
      const room = getValidatedRoom(token);
      const participant = requireParticipantForRoom(participantId, room.id);

      requireReadyMediaForPlayback(room);

      const durationSeconds = getRoomDurationSeconds(room);
      const reportedTime = clampPlaybackTime(input.currentTime, durationSeconds);
      const canonicalTime = getCanonicalPlaybackTime(room);
      const driftMs = Math.round((canonicalTime - reportedTime) * 1000);
      const stateMismatch = input.playbackState !== room.playbackState;
      const rateMismatch = typeof input.playbackRate === 'number'
        && Math.abs(input.playbackRate - room.playbackRate) > 0.05;
      const absoluteDriftMs = Math.abs(driftMs);

      let mode: PlaybackResyncMode | null = null;

      if (stateMismatch || rateMismatch) {
        mode = 'hard';
      } else if (room.playbackState === 'paused' && absoluteDriftMs >= PAUSED_RESYNC_THRESHOLD_MS) {
        mode = 'hard';
      } else if (absoluteDriftMs >= HARD_RESYNC_THRESHOLD_MS) {
        mode = 'hard';
      } else if (absoluteDriftMs >= SOFT_RESYNC_THRESHOLD_MS) {
        mode = 'soft';
      }

      return {
        roomToken: room.token,
        participant,
        room,
        driftMs,
        shouldResync: mode !== null,
        mode
      };
    },

    leaveRoom(token: string, participantId: string) {
      const room = getValidatedRoom(token);
      const participant = requireParticipantForRoom(participantId, room.id);
      const now = new Date().toISOString();

      disconnectParticipantStatement.run(now, participant.id);

      return {
        roomToken: room.token,
        participant: getParticipantById(participant.id) ?? {
          ...participant,
          socketId: null,
          lastSeenAt: now,
          connectionState: 'disconnected'
        },
        response: buildRoomLookupResponse(room)
      };
    },

    disconnectParticipantBySocketId(socketId: string) {
      const row = getParticipantBySocketIdStatement.get(socketId) as ParticipantRow | undefined;

      if (!row) {
        return null;
      }

      const participant = mapParticipant(row);
      const room = getRoomByIdRecord(participant.roomId);

      if (!room) {
        return null;
      }

      const now = new Date().toISOString();
      disconnectParticipantStatement.run(now, participant.id);

      return {
        roomToken: room.token,
        participant: getParticipantById(participant.id) ?? {
          ...participant,
          socketId: null,
          lastSeenAt: now,
          connectionState: 'disconnected'
        },
        response: buildRoomLookupResponse(room)
      };
    },

    closeRoom(token: string): void {
      const room = getRoomByTokenRecord(token);

      if (!room) {
        throw new HttpError(404, 'Room not found');
      }

      updateRoomStatusStatement.run('closed', token);
      disconnectParticipantsByRoomIdStatement.run(new Date().toISOString(), room.id);
    }
  };
}
