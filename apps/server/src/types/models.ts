export type ServiceHealth = {
  status: 'ok';
  service: 'videoshare-server';
  timestamp: string;
  uptimeSeconds: number;
};

export type PlaybackState = 'paused' | 'playing';

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

export type RoomJoinResponse = RoomLookupResponse & {
  participant: Participant;
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
};

export type DesktopStatus = {
  apiBaseUrl: string;
  webUrl: string;
  lanApiBaseUrl: string | null;
  lanWebUrl: string | null;
  tauri: 'ready';
};
