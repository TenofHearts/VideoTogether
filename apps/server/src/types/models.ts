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

type PlaybackState = 'paused' | 'playing';

export type PlaybackResyncMode = 'soft' | 'hard';

type RoomStatus = 'active' | 'closed' | 'expired';

type MediaStatus = 'pending' | 'processing' | 'ready' | 'error';

type SubtitleFormat = 'srt' | 'vtt' | 'ass';

type ParticipantRole = 'host' | 'guest';

type ParticipantConnectionState = 'connected' | 'disconnected';

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

