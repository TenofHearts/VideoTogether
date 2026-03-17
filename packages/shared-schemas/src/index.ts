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

import { z } from 'zod';

export const serviceHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('videoshare-server'),
  timestamp: z.string().datetime(),
  uptimeSeconds: z.number().nonnegative()
});

export const cleanupRunSummarySchema = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  expiredRoomsClosed: z.number().int().nonnegative(),
  idleRoomsClosed: z.number().int().nonnegative(),
  hlsDirectoriesRemoved: z.number().int().nonnegative(),
  subtitleFilesRemoved: z.number().int().nonnegative(),
  mediaEvicted: z.number().int().nonnegative(),
  warnings: z.array(z.string())
});

export const cleanupStatusSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().positive(),
  idleRoomTtlMinutes: z.number().positive(),
  hlsRetentionHours: z.number().positive(),
  lastRun: cleanupRunSummarySchema.nullable()
});

export const systemDiagnosticsSchema = z.object({
  totalRooms: z.number().int().nonnegative(),
  activeRooms: z.number().int().nonnegative(),
  totalParticipants: z.number().int().nonnegative(),
  connectedParticipants: z.number().int().nonnegative(),
  totalMedia: z.number().int().nonnegative(),
  readyMedia: z.number().int().nonnegative(),
  totalSubtitles: z.number().int().nonnegative(),
  activeProcessingJobs: z.number().int().nonnegative()
});

export const playbackStateSchema = z.enum(['paused', 'playing']);

export const playbackResyncModeSchema = z.enum(['soft', 'hard']);

export const roomStatusSchema = z.enum(['active', 'closed', 'expired']);

export const mediaStatusSchema = z.enum(['pending', 'processing', 'ready', 'error']);

export const subtitleFormatSchema = z.enum(['srt', 'vtt', 'ass']);

export const participantRoleSchema = z.enum(['host', 'guest']);

export const participantConnectionStateSchema = z.enum(['connected', 'disconnected']);

export const roomSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(16),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  status: roomStatusSchema,
  hostClientId: z.string().uuid().nullable(),
  currentPlaybackTime: z.number().nonnegative(),
  playbackState: playbackStateSchema,
  playbackRate: z.number().positive(),
  lastStateUpdatedAt: z.string().datetime(),
  activeMediaId: z.string().uuid().nullable(),
  activeSubtitleId: z.string().uuid().nullable()
});

export const mediaSchema = z.object({
  id: z.string().uuid(),
  originalFileName: z.string().min(1),
  sourcePath: z.string().min(1),
  durationMs: z.number().int().nonnegative().nullable(),
  container: z.string().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  hlsManifestPath: z.string().nullable(),
  processingError: z.string().nullable(),
  status: mediaStatusSchema,
  createdAt: z.string().datetime()
});

export const subtitleSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
  label: z.string().min(1),
  language: z.string().nullable(),
  format: subtitleFormatSchema,
  sourcePath: z.string().min(1),
  servedPath: z.string().nullable(),
  isDefault: z.boolean()
});

export const participantSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  displayName: z.string().min(1),
  role: participantRoleSchema,
  joinedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  socketId: z.string().nullable(),
  connectionState: participantConnectionStateSchema
});

export const createRoomRequestSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  hostClientId: z.string().min(1).nullable().optional(),
  hostDisplayName: z.string().min(1).max(48).nullable().optional(),
  activeMediaId: z.string().uuid().nullable().optional(),
  activeSubtitleId: z.string().uuid().nullable().optional()
});

export const joinRoomRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(48),
  participantId: z.string().uuid().nullable().optional()
});

export const roomLookupResponseSchema = z.object({
  room: roomSchema,
  media: mediaSchema.nullable(),
  subtitles: z.array(subtitleSchema),
  participants: z.array(participantSchema),
  shareUrl: z.string().url(),
  socketPath: z.string().min(1)
});

export const roomJoinResponseSchema = roomLookupResponseSchema.extend({
  participant: participantSchema
});

export const playbackCommandPayloadSchema = z.object({
  token: z.string().min(1),
  participantId: z.string().uuid(),
  currentTime: z.number().finite().nonnegative(),
  playbackRate: z.number().positive().optional()
});

export const playbackStateReportPayloadSchema = playbackCommandPayloadSchema.extend({
  playbackState: playbackStateSchema
});

export const playbackUpdateEventSchema = z.object({
  room: roomSchema,
  sourceParticipantId: z.string().uuid().nullable(),
  reason: z.enum(['play', 'pause', 'seek']),
  issuedAt: z.string().datetime()
});

export const playbackResyncEventSchema = z.object({
  room: roomSchema,
  mode: playbackResyncModeSchema,
  driftMs: z.number().int(),
  issuedAt: z.string().datetime()
});

export const mediaOperationResponseSchema = z.object({
  media: mediaSchema,
  manifestUrl: z.string().url().nullable(),
  playerUrl: z.string().url(),
  processingQueued: z.boolean()
});

export const subtitleOperationResponseSchema = z.object({
  subtitle: subtitleSchema,
  subtitleUrl: z.string().url()
});

export const mediaListResponseSchema = z.object({
  media: z.array(mediaSchema)
});

export const mediaSubtitlesResponseSchema = z.object({
  mediaId: z.string().uuid(),
  subtitles: z.array(subtitleSchema)
});

export const systemStatusSchema = z.object({
  apiBaseUrl: z.string().url(),
  webUrl: z.string().url(),
  tauri: z.literal('ready'),
  database: z.object({
    path: z.string().min(1),
    connected: z.boolean()
  }),
  storage: z.object({
    mediaDir: z.string().min(1),
    hlsDir: z.string().min(1),
    subtitleDir: z.string().min(1),
    tempDir: z.string().min(1)
  }),
  realtime: z.object({
    transport: z.literal('socket.io'),
    path: z.string().min(1),
    status: z.enum(['ready', 'disabled']),
    detail: z.string().min(1)
  }),
  cleanup: cleanupStatusSchema,
  diagnostics: systemDiagnosticsSchema
});

export const desktopStatusSchema = z.object({
  apiBaseUrl: z.string().url(),
  webUrl: z.string().url(),
  publicWebUrl: z.string().url().nullable(),
  lanApiBaseUrl: z.string().url().nullable(),
  lanWebUrl: z.string().url().nullable(),
  tauri: z.literal('ready')
});



