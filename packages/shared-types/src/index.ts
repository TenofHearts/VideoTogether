export type ServiceHealth = {
  status: 'ok';
  service: 'videoshare-server';
  timestamp: string;
  uptimeSeconds: number;
};

export type CleanupRunSummary = {
  startedAt: string;
  finishedAt: string;
  expiredRoomsClosed: number;
  idleRoomsClosed: number;
  hlsDirectoriesRemoved: number;
  subtitleFilesRemoved: number;
  mediaEvicted: number;
  warnings: string[];
};

export type CleanupStatus = {
  enabled: boolean;
  intervalMinutes: number;
  idleRoomTtlMinutes: number;
  hlsRetentionHours: number;
  lastRun: CleanupRunSummary | null;
};

export type SystemDiagnostics = {
  totalRooms: number;
  activeRooms: number;
  totalParticipants: number;
  connectedParticipants: number;
  totalMedia: number;
  readyMedia: number;
  totalSubtitles: number;
  activeProcessingJobs: number;
};

export type PlaybackState = 'paused' | 'playing';

export type PlaybackResyncMode = 'soft' | 'hard';

export type RoomStatus = 'active' | 'closed' | 'expired';

export type MediaStatus = 'pending' | 'processing' | 'ready' | 'error';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export type ParticipantRole = 'host' | 'guest';

export type ParticipantConnectionState = 'connected' | 'disconnected';

export type Room = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  status: RoomStatus;
  hostClientId: string | null;
  currentPlaybackTime: number;
  playbackState: PlaybackState;
  playbackRate: number;
  lastStateUpdatedAt: string;
  activeMediaId: string | null;
  activeSubtitleId: string | null;
};

export type Media = {
  id: string;
  originalFileName: string;
  sourcePath: string;
  durationMs: number | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  hlsManifestPath: string | null;
  processingError: string | null;
  status: MediaStatus;
  createdAt: string;
};

export type Subtitle = {
  id: string;
  mediaId: string;
  label: string;
  language: string | null;
  format: SubtitleFormat;
  sourcePath: string;
  servedPath: string | null;
  isDefault: boolean;
};

export type Participant = {
  id: string;
  roomId: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
  lastSeenAt: string;
  socketId: string | null;
  connectionState: ParticipantConnectionState;
};

export type CreateRoomRequest = {
  expiresAt?: string | null;
  hostClientId?: string | null;
  hostDisplayName?: string | null;
  activeMediaId?: string | null;
  activeSubtitleId?: string | null;
};

export type JoinRoomRequest = {
  displayName: string;
  participantId?: string | null;
};

export type RoomLookupResponse = {
  room: Room;
  media: Media | null;
  subtitles: Subtitle[];
  participants: Participant[];
  shareUrl: string;
  socketPath: string;
};

export type CreateRoomResponse = RoomLookupResponse;

export type RoomJoinResponse = RoomLookupResponse & {
  participant: Participant;
};

export type PlaybackCommandPayload = {
  token: string;
  participantId: string;
  currentTime: number;
  playbackRate?: number;
};

export type PlaybackStateReportPayload = PlaybackCommandPayload & {
  playbackState: PlaybackState;
};

export type PlaybackUpdateEvent = {
  room: Room;
  sourceParticipantId: string | null;
  reason: 'play' | 'pause' | 'seek';
  issuedAt: string;
};

export type PlaybackResyncEvent = {
  room: Room;
  mode: PlaybackResyncMode;
  driftMs: number;
  issuedAt: string;
};

export type MediaOperationResponse = {
  media: Media;
  manifestUrl: string | null;
  playerUrl: string;
  processingQueued: boolean;
};

export type SubtitleOperationResponse = {
  subtitle: Subtitle;
  subtitleUrl: string;
};

export type MediaListResponse = {
  media: Media[];
};

export type MediaSubtitlesResponse = {
  mediaId: string;
  subtitles: Subtitle[];
};

export type SystemStatus = {
  apiBaseUrl: string;
  webUrl: string;
  tauri: 'ready';
  database: {
    path: string;
    connected: boolean;
  };
  storage: {
    mediaDir: string;
    hlsDir: string;
    subtitleDir: string;
    tempDir: string;
  };
  realtime: {
    transport: 'socket.io';
    path: string;
    status: 'ready' | 'disabled';
    detail: string;
  };
  cleanup: CleanupStatus;
  diagnostics: SystemDiagnostics;
};

export type DesktopStatus = {
  apiBaseUrl: string;
  webUrl: string;
  lanApiBaseUrl: string | null;
  lanWebUrl: string | null;
  tauri: 'ready';
};

