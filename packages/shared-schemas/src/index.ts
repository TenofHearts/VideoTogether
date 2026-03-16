import { z } from 'zod';

export const serviceHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('videoshare-server'),
  timestamp: z.string().datetime(),
  uptimeSeconds: z.number().nonnegative()
});

export const playbackStateSchema = z.enum(['paused', 'playing']);

export const roomStatusSchema = z.enum(['active', 'closed', 'expired']);

export const mediaStatusSchema = z.enum(['pending', 'processing', 'ready', 'error']);

export const subtitleFormatSchema = z.enum(['srt', 'vtt']);

export const roomSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(16),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  status: roomStatusSchema,
  hostClientId: z.string().nullable(),
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

export const createRoomRequestSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  hostClientId: z.string().min(1).nullable().optional(),
  activeMediaId: z.string().uuid().nullable().optional(),
  activeSubtitleId: z.string().uuid().nullable().optional()
});

export const roomLookupResponseSchema = z.object({
  room: roomSchema,
  media: mediaSchema.nullable(),
  subtitles: z.array(subtitleSchema),
  shareUrl: z.string().url(),
  socketPath: z.string().min(1)
});

export const mediaOperationResponseSchema = z.object({
  media: mediaSchema,
  manifestUrl: z.string().url().nullable(),
  playerUrl: z.string().url(),
  processingQueued: z.boolean()
});

export const mediaListResponseSchema = z.object({
  media: z.array(mediaSchema)
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
  })
});

export const desktopStatusSchema = z.object({
  apiBaseUrl: z.string().url(),
  webUrl: z.string().url(),
  tauri: z.literal('ready')
});
