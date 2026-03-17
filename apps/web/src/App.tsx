import { type FormEvent, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type {
  Media,
  MediaListResponse,
  MediaSubtitlesResponse,
  Participant,
  PlaybackState,
  PlaybackUpdateEvent,
  Room,
  RoomJoinResponse,
  RoomLookupResponse,
  ServiceHealth,
  Subtitle,
  SystemStatus
} from '@videoshare/shared-types';
import {
  buildRoomUrl,
  buildUrlFromBase,
  formatTimestamp,
  getApiBaseUrl
} from '@videoshare/shared-utils';

import { loadHlsConstructor, type HlsErrorData } from './lib/hls';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: ServiceHealth };

type SystemState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: SystemStatus };

type SocketState =
  | { kind: 'idle'; message: string }
  | { kind: 'connecting'; message: string }
  | { kind: 'connected'; message: string; socketId: string }
  | { kind: 'error'; message: string };

type RecentMediaState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: Media[] };

type SelectedMediaState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: Media };

type RoomState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; statusCode?: number }
  | { kind: 'success'; data: RoomLookupResponse };

type JoinState =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; participant: Participant };

type SubtitleState =
  | { kind: 'idle'; data: Subtitle[] }
  | { kind: 'loading'; data: Subtitle[] }
  | { kind: 'error'; message: string; data: Subtitle[] }
  | { kind: 'success'; data: Subtitle[] };

type RouteState =
  | { kind: 'home'; mediaId: string | null }
  | {
      kind: 'room';
      token: string;
      participantId: string | null;
      displayName: string | null;
    };

type RealtimeErrorPayload = {
  message?: string;
  statusCode?: number;
};

type PlayerRuntimeState =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'ready'
  | 'seeking'
  | 'error';

const SOFT_RESYNC_WINDOW_MS = 1500;

function getPlaybackSignature(room: Room): string {
  return [
    room.currentPlaybackTime,
    room.playbackState,
    room.playbackRate,
    room.lastStateUpdatedAt
  ].join(':');
}

function getCanonicalPlaybackTime(room: Room, nowMs = Date.now()): number {
  if (room.playbackState !== 'playing') {
    return room.currentPlaybackTime;
  }

  const updatedAtMs = Date.parse(room.lastStateUpdatedAt);
  const elapsedSeconds = Number.isNaN(updatedAtMs)
    ? 0
    : Math.max(0, nowMs - updatedAtMs) / 1000;

  return room.currentPlaybackTime + elapsedSeconds * room.playbackRate;
}

function mergeRoomPlayback(
  current: RoomLookupResponse,
  room: Room
): RoomLookupResponse {
  return {
    ...current,
    room
  };
}

function mergeRoomSnapshot(
  current: RoomLookupResponse | null,
  next: RoomLookupResponse
): RoomLookupResponse {
  return {
    ...next,
    media:
      current?.media && next.media && isSameMedia(current.media, next.media)
        ? current.media
        : next.media,
    subtitles:
      current && isSameSubtitleList(current.subtitles, next.subtitles)
        ? current.subtitles
        : next.subtitles
  };
}

function formatPlaybackStateLabel(value: PlaybackState): string {
  return value === 'playing' ? 'Playing' : 'Paused';
}

function formatPlayerStateLabel(value: PlayerRuntimeState): string {
  switch (value) {
    case 'loading':
      return 'Loading stream';
    case 'buffering':
      return 'Buffering';
    case 'ready':
      return 'Ready';
    case 'seeking':
      return 'Seeking';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const appBasePath = (() => {
  const configuredBase = import.meta.env.BASE_URL ?? '/';
  if (configuredBase === '/') {
    return '';
  }
  return configuredBase.endsWith('/')
    ? configuredBase.slice(0, -1)
    : configuredBase;
})();

function stripAppBasePath(pathname: string): string {
  if (!appBasePath) {
    return pathname || '/';
  }
  if (pathname === appBasePath) {
    return '/';
  }
  if (pathname.startsWith(`${appBasePath}/`)) {
    return pathname.slice(appBasePath.length) || '/';
  }
  return pathname || '/';
}

function buildAppPath(relativePath: string): string {
  const normalized = relativePath === '/' ? '' : relativePath;
  if (!normalized) {
    return appBasePath || '/';
  }
  return `${appBasePath}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

function parseRouteFromLocation(): RouteState {
  const currentUrl = new URL(window.location.href);
  const pathname =
    stripAppBasePath(currentUrl.pathname).replace(/\/+$/, '') || '/';
  const segments = pathname.split('/').filter(Boolean);
  const legacyToken = currentUrl.searchParams.get('roomToken');
  const participantId = currentUrl.searchParams.get('participantId');
  const displayName = currentUrl.searchParams.get('displayName');

  if (segments[0] === 'room' && segments[1]) {
    return {
      kind: 'room',
      token: decodeURIComponent(segments.slice(1).join('/')),
      participantId,
      displayName
    };
  }

  if (legacyToken) {
    return {
      kind: 'room',
      token: legacyToken,
      participantId,
      displayName
    };
  }

  return {
    kind: 'home',
    mediaId: currentUrl.searchParams.get('mediaId')
  };
}

function getManifestUrl(
  media: Pick<Media, 'id' | 'hlsManifestPath'>
): string | null {
  if (!media.hlsManifestPath) {
    return null;
  }
  return buildUrlFromBase(
    apiBaseUrl,
    `media/${media.id}/${media.hlsManifestPath}`
  );
}

function getSubtitleUrl(subtitleId: string): string {
  return buildUrlFromBase(apiBaseUrl, `subtitles/${subtitleId}.vtt`);
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return 'Unknown duration';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, '0')
    )
    .join(':');
}

function getStatusLabel(status: Media['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting to start';
    case 'processing':
      return 'Processing to HLS';
    case 'ready':
      return 'Ready to play';
    case 'error':
      return 'Processing failed';
    default:
      return status;
  }
}

function getParticipantBadge(participant: Participant): string {
  const roleLabel = participant.role === 'host' ? 'Host' : 'Guest';
  const stateLabel =
    participant.connectionState === 'connected' ? 'online' : 'offline';
  return `${roleLabel} ${stateLabel}`;
}

function isSameMedia(left: Media, right: Media): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.hlsManifestPath === right.hlsManifestPath &&
    left.processingError === right.processingError &&
    left.durationMs === right.durationMs
  );
}

function isSameSubtitleList(left: Subtitle[], right: Subtitle[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((subtitle, index) => {
    const other = right[index];
    return (
      subtitle.id === other?.id &&
      subtitle.label === other?.label &&
      subtitle.format === other?.format &&
      subtitle.isDefault === other?.isDefault
    );
  });
}

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return payload?.message ?? `${fallback} (${response.status})`;
}

function getStoredParticipantId(token: string): string | null {
  try {
    return window.localStorage.getItem(
      `videoshare:room:${token}:participantId`
    );
  } catch {
    return null;
  }
}

function getStoredDisplayName(token: string): string {
  try {
    return (
      window.localStorage.getItem(`videoshare:room:${token}:displayName`) ??
      'Guest'
    );
  } catch {
    return 'Guest';
  }
}

function saveParticipantSession(
  token: string,
  participantId: string,
  displayName: string
): void {
  try {
    window.localStorage.setItem(
      `videoshare:room:${token}:participantId`,
      participantId
    );
    window.localStorage.setItem(
      `videoshare:room:${token}:displayName`,
      displayName
    );
  } catch {
    // Ignore storage failures.
  }
}

function clearParticipantSession(token: string): void {
  try {
    window.localStorage.removeItem(`videoshare:room:${token}:participantId`);
    window.localStorage.removeItem(`videoshare:room:${token}:displayName`);
  } catch {
    // Ignore storage failures.
  }
}

type RoomAccessInput = {
  token: string;
  participantId: string | null;
  displayName: string | null;
};

function extractRoomAccess(input: string): RoomAccessInput {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      token: '',
      participantId: null,
      displayName: null
    };
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean);

    if (
      segments[segments.length - 2] === 'room' &&
      segments[segments.length - 1]
    ) {
      return {
        token: decodeURIComponent(segments[segments.length - 1]),
        participantId: url.searchParams.get('participantId'),
        displayName: url.searchParams.get('displayName')
      };
    }
  } catch {
    return {
      token: trimmed.replace(/^\/+|\/+$/g, ''),
      participantId: null,
      displayName: null
    };
  }

  return {
    token: trimmed,
    participantId: null,
    displayName: null
  };
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() =>
    parseRouteFromLocation()
  );
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [system, setSystem] = useState<SystemState>({ kind: 'loading' });
  const [socketState, setSocketState] = useState<SocketState>({
    kind: 'idle',
    message: 'Join a room to activate realtime presence.'
  });
  const [recentMedia, setRecentMedia] = useState<RecentMediaState>({
    kind: 'loading'
  });
  const [selectedMedia, setSelectedMedia] = useState<SelectedMediaState>({
    kind: 'idle'
  });
  const [roomState, setRoomState] = useState<RoomState>({ kind: 'idle' });
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });
  const [subtitleState, setSubtitleState] = useState<SubtitleState>({
    kind: 'idle',
    data: []
  });
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(
    null
  );
  const [playerState, setPlayerState] = useState<PlayerRuntimeState>('idle');
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [subtitleMessage, setSubtitleMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [subtitleSaving, setSubtitleSaving] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('Guest');
  const [notice, setNotice] = useState<string | null>(null);
  const [roomRefreshNonce, setRoomRefreshNonce] = useState(0);
  const [realtimeRetryNonce, setRealtimeRetryNonce] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const autoJoinTokenRef = useRef<string | null>(null);
  const softResyncTimerRef = useRef<number | null>(null);
  const suppressedPlaybackEventsRef = useRef({
    play: 0,
    pause: 0,
    seek: 0
  });
  const lastAppliedPlaybackSignatureRef = useRef<string | null>(null);
  const roomToken = route.kind === 'room' ? route.token : null;
  const mediaId = route.kind === 'home' ? route.mediaId : null;

  function suppressNextPlaybackEvent(eventName: 'play' | 'pause' | 'seek') {
    suppressedPlaybackEventsRef.current[eventName] += 1;
  }

  function shouldSuppressPlaybackEvent(eventName: 'play' | 'pause' | 'seek') {
    const pending = suppressedPlaybackEventsRef.current[eventName];

    if (pending <= 0) {
      return false;
    }

    suppressedPlaybackEventsRef.current[eventName] -= 1;
    return true;
  }

  function clearSoftResyncTimer() {
    if (softResyncTimerRef.current) {
      window.clearTimeout(softResyncTimerRef.current);
      softResyncTimerRef.current = null;
    }
  }

  function applyPlaybackRoom(
    room: Room,
    options?: {
      mode?: 'update' | 'soft' | 'hard';
      driftMs?: number;
      reason?: PlaybackUpdateEvent['reason'];
    }
  ) {
    const video = videoRef.current;

    if (!video || route.kind !== 'room' || joinState.kind !== 'success') {
      return;
    }

    const targetTime = getCanonicalPlaybackTime(room);
    const targetRate = room.playbackRate > 0 ? room.playbackRate : 1;
    const currentTime = Number.isFinite(video.currentTime)
      ? video.currentTime
      : 0;
    const driftMs =
      options?.driftMs ?? Math.round((targetTime - currentTime) * 1000);
    const needsHardSync =
      options?.mode === 'hard' ||
      room.playbackState === 'paused' ||
      Math.abs(driftMs) >= 1500;

    clearSoftResyncTimer();

    if (video.readyState === 0) {
      const retry = () => {
        video.removeEventListener('loadedmetadata', retry);
        applyPlaybackRoom(room, options);
      };
      video.addEventListener('loadedmetadata', retry, { once: true });
      return;
    }

    if (Math.abs(targetTime - currentTime) > 0.05 && needsHardSync) {
      suppressNextPlaybackEvent('seek');
      video.currentTime = Math.max(0, targetTime);
    }

    if (room.playbackState === 'playing') {
      video.playbackRate = targetRate;
      if (!needsHardSync && options?.mode === 'soft') {
        video.playbackRate =
          driftMs > 0
            ? Math.min(targetRate + 0.08, 1.15)
            : Math.max(targetRate - 0.08, 0.85);
        softResyncTimerRef.current = window.setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.playbackRate = targetRate;
          }
          softResyncTimerRef.current = null;
        }, SOFT_RESYNC_WINDOW_MS);
      }

      const requestedPlay = video.paused;
      if (requestedPlay) {
        suppressNextPlaybackEvent('play');
      }

      void video.play().catch(() => {
        if (requestedPlay) {
          suppressedPlaybackEventsRef.current.play = Math.max(
            0,
            suppressedPlaybackEventsRef.current.play - 1
          );
        }

        setSyncMessage(
          'Shared playback is waiting for a local play interaction.'
        );
      });
    } else {
      if (!video.paused) {
        suppressNextPlaybackEvent('pause');
      }

      video.pause();
      video.playbackRate = targetRate;
    }

    if (options?.mode === 'soft') {
      setSyncMessage(`Correcting ${Math.abs(driftMs)} ms of playback drift.`);
      return;
    }

    if (options?.reason === 'seek') {
      setSyncMessage('Applied a room seek update.');
      return;
    }

    if (options?.reason === 'play' || room.playbackState === 'playing') {
      setSyncMessage('Shared playback is synchronized.');
      return;
    }

    setSyncMessage('Shared playback is paused in sync.');
  }

  useEffect(() => {
    function handlePopState() {
      setRoute(parseRouteFromLocation());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (route.kind === 'room') {
      setDisplayNameInput(
        route.displayName ?? getStoredDisplayName(route.token)
      );
      setRoomInput(buildRoomUrl(window.location.origin, route.token));
      setRoomState({ kind: 'loading' });
      setJoinState({ kind: 'idle' });
      setSubtitleState({ kind: 'idle', data: [] });
      setSelectedSubtitleId(null);
      setNotice(null);
      setSyncMessage(null);
      autoJoinTokenRef.current = null;
      lastAppliedPlaybackSignatureRef.current = null;
      return;
    }

    setSelectedMedia(route.mediaId ? { kind: 'loading' } : { kind: 'idle' });
    setRoomState({ kind: 'idle' });
    setJoinState({ kind: 'idle' });
    setNotice(null);
    setSyncMessage(null);
    autoJoinTokenRef.current = null;
    lastAppliedPlaybackSignatureRef.current = null;
  }, [
    mediaId,
    roomToken,
    route.kind,
    route.kind === 'room' ? route.displayName : null,
    route.kind === 'room' ? route.participantId : null
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }
        const data = (await response.json()) as ServiceHealth;
        if (!cancelled) {
          setHealth({ kind: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown health error'
          });
        }
      }
    }

    async function loadSystem() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/system/status`);
        if (!response.ok) {
          throw new Error(`System status failed with ${response.status}`);
        }
        const data = (await response.json()) as SystemStatus;
        if (!cancelled) {
          setSystem({ kind: 'success', data });
        }
      } catch (error) {
        if (!cancelled) {
          setSystem({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown system error'
          });
        }
      }
    }

    void loadHealth();
    void loadSystem();
    const timer = window.setInterval(() => {
      void loadHealth();
      void loadSystem();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentMedia() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media`);
        if (!response.ok) {
          throw new Error(`Media list failed with ${response.status}`);
        }
        const data = (await response.json()) as MediaListResponse;
        if (!cancelled) {
          setRecentMedia({ kind: 'success', data: data.media });
        }
      } catch (error) {
        if (!cancelled) {
          setRecentMedia({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown media error'
          });
        }
      }
    }

    void loadRecentMedia();
    const timer = window.setInterval(() => {
      void loadRecentMedia();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!roomToken) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function loadRoom() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/rooms/${roomToken}`);
        if (!response.ok) {
          const message = await readErrorMessage(
            response,
            'Room lookup failed'
          );
          if (!cancelled) {
            setRoomState({
              kind: 'error',
              message,
              statusCode: response.status
            });
          }
          if (
            response.status !== 404 &&
            response.status !== 410 &&
            !cancelled
          ) {
            timer = window.setTimeout(() => void loadRoom(), 5000);
          }
          return;
        }

        const data = (await response.json()) as RoomLookupResponse;
        if (cancelled) {
          return;
        }

        setRoomState((current) => ({
          kind: 'success',
          data:
            current.kind === 'success'
              ? mergeRoomSnapshot(current.data, data)
              : data
        }));
        setSubtitleState((current) => {
          if (isSameSubtitleList(current.data, data.subtitles)) {
            return current.kind === 'success'
              ? current
              : { kind: 'success', data: current.data };
          }
          return { kind: 'success', data: data.subtitles };
        });
        setSelectedSubtitleId(data.room.activeSubtitleId);
        timer = window.setTimeout(() => void loadRoom(), 10000);
      } catch (error) {
        if (!cancelled) {
          setRoomState({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown room error'
          });
          timer = window.setTimeout(() => void loadRoom(), 5000);
        }
      }
    }

    void loadRoom();
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [roomRefreshNonce, roomToken]);

  useEffect(() => {
    if (!mediaId) {
      if (route.kind === 'home') {
        setSelectedMedia({ kind: 'idle' });
      }
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function loadMedia() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media/${mediaId}`);
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, 'Media lookup failed')
          );
        }
        const data = (await response.json()) as Media;
        if (cancelled) {
          return;
        }

        setSelectedMedia((current) => {
          if (current.kind === 'success' && isSameMedia(current.data, data)) {
            return current;
          }
          return { kind: 'success', data };
        });

        if (data.status === 'pending' || data.status === 'processing') {
          timer = window.setTimeout(() => void loadMedia(), 3000);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedMedia({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown media error'
          });
        }
      }
    }

    setSelectedMedia({ kind: 'loading' });
    void loadMedia();
    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [mediaId, route.kind]);

  useEffect(() => {
    if (!mediaId) {
      return;
    }

    let cancelled = false;
    setSubtitleState((current) => ({ kind: 'loading', data: current.data }));

    async function loadSubtitles() {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/media/${mediaId}/subtitles`
        );
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, 'Subtitle lookup failed')
          );
        }
        const data = (await response.json()) as MediaSubtitlesResponse;
        if (!cancelled) {
          setSubtitleState({ kind: 'success', data: data.subtitles });
          setSelectedSubtitleId(
            (current) =>
              current ??
              data.subtitles.find((subtitle) => subtitle.isDefault)?.id ??
              null
          );
        }
      } catch (error) {
        if (!cancelled) {
          setSubtitleState({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'Unknown subtitle error',
            data: []
          });
        }
      }
    }

    void loadSubtitles();
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  useEffect(() => {
    if (
      route.kind !== 'room' ||
      roomState.kind !== 'success' ||
      joinState.kind === 'success' ||
      joinState.kind === 'joining'
    ) {
      return;
    }

    const autoJoinParticipantId =
      route.participantId ??
      (roomToken ? getStoredParticipantId(roomToken) : null);
    if (!autoJoinParticipantId || autoJoinTokenRef.current === roomToken) {
      return;
    }

    autoJoinTokenRef.current = roomToken;
    void joinRoom(
      route.displayName ?? displayNameInput,
      autoJoinParticipantId,
      true
    );
  }, [
    displayNameInput,
    joinState.kind,
    route.kind === 'room' ? route.displayName : null,
    route.kind === 'room' ? route.participantId : null,
    roomState.kind === 'success' ? roomState.data.room.token : 'idle',
    roomToken ?? 'home'
  ]);

  useEffect(() => {
    if (
      route.kind !== 'room' ||
      roomState.kind !== 'success' ||
      joinState.kind !== 'success'
    ) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketState({
        kind: 'idle',
        message: 'Join a room to activate realtime presence.'
      });
      return;
    }

    setSocketState({
      kind: 'connecting',
      message: 'Opening realtime room presence...'
    });

    const socket = io(apiBaseUrl, {
      path: roomState.data.socketPath,
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketState({
        kind: 'connecting',
        message: 'Socket connected. Joining room...'
      });
      socket.emit('room:join', {
        token: roomToken,
        participantId: joinState.participant.id
      });
    });

    socket.on(
      'room:joined',
      (payload: {
        participant: Participant;
        room: RoomLookupResponse['room'];
        participants: Participant[];
      }) => {
        setJoinState({ kind: 'success', participant: payload.participant });
        setSocketState({
          kind: 'connected',
          message: 'Realtime presence active.',
          socketId: socket.id ?? 'unknown'
        });
        setRoomState((current) =>
          current.kind === 'success'
            ? {
                kind: 'success',
                data: {
                  ...current.data,
                  room: payload.room,
                  participants: payload.participants
                }
              }
            : current
        );
        setNotice('Realtime room connection is healthy.');
      }
    );

    socket.on('room:state', (payload: RoomLookupResponse) => {
      setRoomState((current) => ({
        kind: 'success',
        data:
          current.kind === 'success'
            ? mergeRoomSnapshot(current.data, payload)
            : payload
      }));
      setSubtitleState((current) => {
        if (isSameSubtitleList(current.data, payload.subtitles)) {
          return current.kind === 'success'
            ? current
            : { kind: 'success', data: current.data };
        }

        return { kind: 'success', data: payload.subtitles };
      });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
    });

    socket.on('playback:update', (payload: PlaybackUpdateEvent) => {
      setRoomState((current) =>
        current.kind === 'success'
          ? {
              kind: 'success',
              data: mergeRoomPlayback(current.data, payload.room)
            }
          : current
      );
      setSyncMessage(
        payload.reason === 'seek'
          ? 'Received a shared seek update.'
          : payload.reason === 'play'
            ? 'Received a shared play update.'
            : 'Received a shared pause update.'
      );
    });


    socket.on('room:participant-joined', (participant: Participant) => {
      setNotice(`${participant.displayName} joined the room.`);
    });

    socket.on('room:participant-left', (participant: Participant) => {
      setNotice(`${participant.displayName} left the room.`);
    });

    socket.on('system:error', (payload: RealtimeErrorPayload) => {
      const message = payload.message ?? 'Unexpected realtime error';
      setSocketState({ kind: 'error', message });
      setNotice(`Realtime error: ${message}`);
      if (payload.statusCode === 403 || payload.statusCode === 410) {
        if (roomToken) {
          clearParticipantSession(roomToken);
        }
        setJoinState({ kind: 'error', message });
      }
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      setSocketState({
        kind: 'connecting',
        message: `Realtime connection lost. Retrying (${attempt})...`
      });
    });

    socket.io.on('reconnect_error', (error: Error) => {
      setSocketState({
        kind: 'error',
        message: `Realtime reconnect failed: ${error.message}`
      });
    });

    socket.io.on('reconnect', () => {
      setSocketState({
        kind: 'connecting',
        message: 'Realtime transport restored. Rejoining room...'
      });
    });

    socket.on('connect_error', (error: Error) => {
      setSocketState({ kind: 'error', message: error.message });
    });

    socket.on('disconnect', (reason: string) => {
      const message =
        reason === 'io client disconnect'
          ? 'Realtime presence disconnected.'
          : `Realtime connection dropped: ${reason}. Waiting to reconnect...`;

      setSocketState({
        kind: reason === 'io client disconnect' ? 'idle' : 'connecting',
        message
      });
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    joinState.kind,
    joinState.kind === 'success' ? joinState.participant.id : 'idle',
    realtimeRetryNonce,
    roomState.kind === 'success' ? roomState.data.socketPath : 'idle',
    roomToken ?? 'home'
  ]);

  useEffect(() => {
    if (route.kind !== 'room' || joinState.kind !== 'success') {
      return;
    }

    const timer = window.setInterval(() => {
      socketRef.current?.emit('participant:heartbeat', {
        token: roomToken,
        participantId: joinState.participant.id
      });
    }, 10000);

    return () => window.clearInterval(timer);
  }, [
    joinState.kind,
    joinState.kind === 'success' ? joinState.participant.id : 'idle',
    roomToken ?? 'home'
  ]);


  const playbackMedia =
    route.kind === 'room'
      ? roomState.kind === 'success'
        ? roomState.data.media
        : null
      : selectedMedia.kind === 'success'
        ? selectedMedia.data
        : null;
  const canPlayMedia = route.kind === 'home' || joinState.kind === 'success';

  useEffect(() => {
    if (
      route.kind !== 'room' ||
      joinState.kind !== 'success' ||
      roomState.kind !== 'success'
    ) {
      return;
    }

    const signature = getPlaybackSignature(roomState.data.room);

    if (lastAppliedPlaybackSignatureRef.current === signature) {
      return;
    }

    lastAppliedPlaybackSignatureRef.current = signature;
    applyPlaybackRoom(roomState.data.room, { mode: 'hard' });
  }, [
    joinState.kind,
    roomState.kind === 'success' ? roomState.data.room.currentPlaybackTime : -1,
    roomState.kind === 'success' ? roomState.data.room.playbackRate : -1,
    roomState.kind === 'success' ? roomState.data.room.playbackState : 'paused',
    roomState.kind === 'success'
      ? roomState.data.room.lastStateUpdatedAt
      : 'idle',
    route.kind
  ]);

  useEffect(() => {
    if (route.kind !== 'room' || joinState.kind !== 'success') {
      clearSoftResyncTimer();
      suppressedPlaybackEventsRef.current = {
        play: 0,
        pause: 0,
        seek: 0
      };
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    const activeVideo = video;
    const activeParticipantId = joinState.participant.id;
    const activeRoomToken = route.token;

    function emitPlaybackEvent(
      eventName: 'playback:play' | 'playback:pause' | 'playback:seek'
    ) {
      const socket = socketRef.current;
      if (!socket || socket.disconnected) {
        return;
      }

      socket.emit(eventName, {
        token: activeRoomToken,
        participantId: activeParticipantId,
        currentTime: Number.isFinite(activeVideo.currentTime)
          ? activeVideo.currentTime
          : 0,
        playbackRate: activeVideo.playbackRate || 1
      });
    }

    const handlePlay = () => {
      if (shouldSuppressPlaybackEvent('play')) {
        return;
      }

      emitPlaybackEvent('playback:play');
    };
    const handlePause = () => {
      if (shouldSuppressPlaybackEvent('pause')) {
        return;
      }

      emitPlaybackEvent('playback:pause');
    };
    const handleSeeked = () => {
      if (shouldSuppressPlaybackEvent('seek')) {
        return;
      }

      emitPlaybackEvent('playback:seek');
    };

    activeVideo.addEventListener('play', handlePlay);
    activeVideo.addEventListener('pause', handlePause);
    activeVideo.addEventListener('seeked', handleSeeked);

    return () => {
      activeVideo.removeEventListener('play', handlePlay);
      activeVideo.removeEventListener('pause', handlePause);
      activeVideo.removeEventListener('seeked', handleSeeked);
    };
  }, [
    joinState.kind,
    joinState.kind === 'success' ? joinState.participant.id : 'idle',
    roomToken ?? 'home',
    route.kind
  ]);

  useEffect(
    () => () => {
      clearSoftResyncTimer();
    },
    []
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleLoadStart = () => {
      setPlayerState('loading');
      setPlayerMessage('Connecting to the host stream...');
    };
    const handleWaiting = () => {
      setPlayerState('buffering');
      setPlayerMessage('Playback is buffering from the host stream...');
    };
    const handleStalled = () => {
      setPlayerState('buffering');
      setPlayerMessage('The stream stalled. Waiting for more data...');
    };
    const handleCanPlay = () => {
      setPlayerState('ready');
      setPlayerMessage('Playback is ready.');
    };
    const handlePlaying = () => {
      setPlayerState('ready');
      setPlayerMessage('Playback is running.');
    };
    const handleSeeking = () => {
      setPlayerState('seeking');
      setPlayerMessage('Seeking through the current stream...');
    };
    const handleSeeked = () => {
      setPlayerState('ready');
      setPlayerMessage('Seek complete.');
    };
    const handleError = () => {
      setPlayerState('error');
      setPlayerMessage('The browser reported a playback error.');
    };

    video.addEventListener('loadstart', handleLoadStart);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('stalled', handleStalled);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('error', handleError);

    const teardownListeners = () => {
      video.removeEventListener('loadstart', handleLoadStart);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('stalled', handleStalled);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('seeking', handleSeeking);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };

    let cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    if (!canPlayMedia) {
      cleanup();
      setPlayerState('idle');
      setPlayerMessage('Join the room to unlock playback.');
      return () => {
        cleanup();
        teardownListeners();
      };
    }

    if (!playbackMedia || !playbackMedia.hlsManifestPath) {
      setPlayerState('idle');
      setPlayerMessage(
        route.kind === 'room'
          ? 'Waiting for the host to provide playable media.'
          : 'Select a movie to start local playback.'
      );
      return teardownListeners;
    }

    if (playbackMedia.status !== 'ready') {
      cleanup();
      setPlayerState('loading');
      setPlayerMessage('Manifest will appear after processing completes.');
      return () => {
        cleanup();
        teardownListeners();
      };
    }

    const manifestUrl = getManifestUrl(playbackMedia);
    if (!manifestUrl) {
      setPlayerState('error');
      setPlayerMessage('Manifest URL could not be resolved.');
      return teardownListeners;
    }

    let cancelled = false;
    setPlayerState('loading');

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      setPlayerMessage('Connecting through native HLS playback.');
      return () => {
        cleanup();
        teardownListeners();
      };
    }

    void loadHlsConstructor()
      .then((Hls) => {
        if (cancelled) {
          return;
        }
        if (!Hls || !Hls.isSupported()) {
          setPlayerState('error');
          setPlayerMessage('This browser could not initialize HLS playback.');
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          maxMaxBufferLength: 120
        });
        hls.loadSource(manifestUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setPlayerState('ready');
          setPlayerMessage('HLS manifest loaded.');
        });
        hls.on(Hls.Events.ERROR, (_eventName: unknown, rawData: unknown) => {
          const data = rawData as HlsErrorData;
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setPlayerState('buffering');
              setPlayerMessage('Stream interrupted. Retrying the next segment...');
              hls.startLoad();
              return;
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              setPlayerState('buffering');
              setPlayerMessage('Recovering from a media decode issue...');
              hls.recoverMediaError();
              return;
            }

            setPlayerState('error');
            setPlayerMessage(
              data.details
                ? `Fatal HLS error: ${data.details}`
                : 'Fatal HLS error.'
            );
          }
        });

        cleanup = () => {
          hls.destroy();
          video.pause();
          video.removeAttribute('src');
          video.load();
        };
      })
      .catch((error) => {
        if (!cancelled) {
          setPlayerState('error');
          setPlayerMessage(
            error instanceof Error
              ? error.message
              : 'Failed to load HLS support'
          );
        }
      });

    return () => {
      cancelled = true;
      cleanup();
      teardownListeners();
    };
  }, [
    canPlayMedia,
    route.kind,
    playbackMedia?.id ?? 'idle',
    playbackMedia?.status ?? 'missing',
    playbackMedia?.hlsManifestPath ?? 'none'
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    Array.from(
      video.querySelectorAll('track[data-managed-subtitle="true"]')
    ).forEach((track) => track.remove());

    subtitleState.data.forEach((subtitle) => {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subtitle.label;
      track.src = getSubtitleUrl(subtitle.id);
      track.srclang = subtitle.language ?? 'und';
      track.default = subtitle.id === selectedSubtitleId;
      track.setAttribute('data-managed-subtitle', 'true');
      track.setAttribute('data-subtitle-id', subtitle.id);
      track.addEventListener('load', () => {
        track.track.mode =
          subtitle.id === selectedSubtitleId ? 'showing' : 'disabled';
      });
      video.appendChild(track);
    });
  }, [selectedSubtitleId, subtitleState.data]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    Array.from(video.textTracks).forEach((track) => {
      track.mode = 'disabled';
    });

    if (!selectedSubtitleId) {
      setSubtitleMessage('Subtitles are off.');
      return;
    }

    const trackElements = Array.from(
      video.querySelectorAll('track[data-managed-subtitle="true"]')
    );
    const trackIndex = trackElements.findIndex(
      (track) => track.getAttribute('data-subtitle-id') === selectedSubtitleId
    );
    const matchingTrack = trackIndex >= 0 ? video.textTracks[trackIndex] : null;

    if (matchingTrack) {
      matchingTrack.mode = 'showing';
      const subtitle = subtitleState.data.find(
        (item) => item.id === selectedSubtitleId
      );
      setSubtitleMessage(
        `Showing subtitle: ${subtitle?.label ?? 'Unknown track'}`
      );
      return;
    }

    setSubtitleMessage('Subtitle track is still loading.');
  }, [selectedSubtitleId, subtitleState.data]);

  const manifestUrl = playbackMedia ? getManifestUrl(playbackMedia) : null;
  const currentRoom = roomState.kind === 'success' ? roomState.data : null;

  async function joinRoom(
    displayName: string,
    participantId?: string | null,
    silent = false
  ) {
    if (route.kind !== 'room') {
      return;
    }

    const nextDisplayName = displayName.trim() || 'Guest';
    try {
      setJoinState({ kind: 'joining' });
      if (!silent) {
        setNotice('Joining the room...');
      }

      const response = await fetch(
        `${apiBaseUrl}/api/rooms/${route.token}/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: nextDisplayName,
            participantId: participantId ?? undefined
          })
        }
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Room join failed'));
      }

      const payload = (await response.json()) as RoomJoinResponse;
      saveParticipantSession(
        route.token,
        payload.participant.id,
        nextDisplayName
      );
      setJoinState({ kind: 'success', participant: payload.participant });
      setRoomState((current) => ({
        kind: 'success',
        data:
          current.kind === 'success'
            ? mergeRoomSnapshot(current.data, payload)
            : payload
      }));
      setSubtitleState({ kind: 'success', data: payload.subtitles });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
      setNotice(`Joined as ${payload.participant.displayName}.`);
    } catch (error) {
      if (participantId) {
        if (roomToken) {
          clearParticipantSession(roomToken);
        }
      }
      setJoinState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to join room'
      });
      if (!silent) {
        setNotice(null);
      }
    }
  }

  async function saveSubtitleSelection(nextSubtitleId: string | null) {
    if (route.kind !== 'room') {
      setSelectedSubtitleId(nextSubtitleId);
      return;
    }

    try {
      setSubtitleSaving(true);
      const response = await fetch(
        `${apiBaseUrl}/api/rooms/${route.token}/subtitle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeSubtitleId: nextSubtitleId })
        }
      );
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Subtitle update failed')
        );
      }
      const payload = (await response.json()) as RoomLookupResponse;
      setRoomState({ kind: 'success', data: payload });
      setSubtitleState({ kind: 'success', data: payload.subtitles });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
    } catch (error) {
      setSubtitleMessage(
        error instanceof Error
          ? error.message
          : 'Failed to save subtitle selection'
      );
    } finally {
      setSubtitleSaving(false);
    }
  }

  function navigateHome(mediaId: string | null) {
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = buildAppPath('/');
    nextUrl.searchParams.delete('roomToken');
    if (mediaId) {
      nextUrl.searchParams.set('mediaId', mediaId);
    } else {
      nextUrl.searchParams.delete('mediaId');
    }
    window.history.pushState({}, '', nextUrl);
    setRoute({ kind: 'home', mediaId });
  }

  function openRoom(access: RoomAccessInput) {
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = buildAppPath(
      `/room/${encodeURIComponent(access.token)}`
    );
    nextUrl.search = '';

    if (access.participantId) {
      nextUrl.searchParams.set('participantId', access.participantId);
    }

    if (access.displayName) {
      nextUrl.searchParams.set('displayName', access.displayName);
    }

    window.history.pushState({}, '', nextUrl);
    setRoute({
      kind: 'room',
      token: access.token,
      participantId: access.participantId,
      displayName: access.displayName
    });
  }

  function retryRoomLookup() {
    setNotice('Retrying room lookup...');
    setRoomState({ kind: 'loading' });
    setRoomRefreshNonce((current) => current + 1);
  }

  function retryRealtimeConnection() {
    setNotice('Retrying realtime connection...');
    setRealtimeRetryNonce((current) => current + 1);
  }

  function handleRoomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const access = extractRoomAccess(roomInput);
    if (!access.token) {
      setNotice('Paste a full room URL or token first.');
      return;
    }
    openRoom(access);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7d8,_#fffaf1_42%,_#d9f0ff)] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
          <p className="text-sm uppercase tracking-[0.35em] text-coral">
            Phase 5
          </p>
          <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Room playback now favors smooth watching with shared play,
            pause, and seek controls.
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-slate-600">
            Use <span className="font-mono">/room/&lt;token&gt;</span> to join a
            private session, recover the current room state after reconnects,
            and keep control changes shared without aggressive drift fixes.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-coral">
                  {route.kind === 'room' ? 'Room' : 'Preview'}
                </p>
                <h2 className="mt-2 font-serif text-3xl">
                  {route.kind === 'room'
                    ? 'Private watch room'
                    : 'Browser playback'}
                </h2>
              </div>
              {route.kind === 'room' ? (
                <button
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                  onClick={() => navigateHome(null)}
                  type="button"
                >
                  Back to landing
                </button>
              ) : playbackMedia ? (
                <button
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                  onClick={() => navigateHome(null)}
                  type="button"
                >
                  Clear selection
                </button>
              ) : null}
            </div>

            {route.kind === 'room' && roomState.kind === 'loading' && (
              <div className="mt-6 rounded-[1.5rem] bg-slate-900 p-8 text-white">
                Validating room token and loading room metadata...
              </div>
            )}

            {route.kind === 'room' && roomState.kind === 'error' && (
              <div className="mt-6 rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-red-700">
                <p className="text-lg font-semibold">
                  {roomState.statusCode === 410
                    ? 'This room is no longer available.'
                    : 'This room could not be opened.'}
                </p>
                <p className="mt-2">{roomState.message}</p>
                {roomState.statusCode !== 404 &&
                  roomState.statusCode !== 410 && (
                    <button
                      className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white"
                      onClick={retryRoomLookup}
                      type="button"
                    >
                      Retry room lookup
                    </button>
                  )}
              </div>
            )}

            {route.kind === 'room' &&
              currentRoom &&
              joinState.kind !== 'success' &&
              roomState.kind === 'success' && (
                <div className="mt-6 flex flex-col gap-4">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      Join room
                    </p>
                    <form
                      className="mt-4 flex flex-col gap-3 md:flex-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void joinRoom(displayNameInput);
                      }}
                    >
                      <input
                        className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm"
                        maxLength={48}
                        onChange={(event) =>
                          setDisplayNameInput(event.target.value)
                        }
                        value={displayNameInput}
                      />
                      <button
                        className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-400"
                        disabled={joinState.kind === 'joining'}
                        type="submit"
                      >
                        {joinState.kind === 'joining'
                          ? 'Joining...'
                          : 'Join room'}
                      </button>
                    </form>
                    {joinState.kind === 'error' && (
                      <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                        {joinState.message}
                      </p>
                    )}
                    {notice && (
                      <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                        {notice}
                      </p>
                    )}
                  </div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="min-w-0 rounded-[1.5rem] bg-slate-100 p-5 text-sm text-slate-700">
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        Room info
                      </p>
                      <p className="mt-2 break-all font-mono text-[13px] text-slate-900">
                        {currentRoom.shareUrl}
                      </p>
                      <p className="mt-2">Status: {currentRoom.room.status}</p>
                      <p className="mt-1">
                        Playback:{' '}
                        {formatPlaybackStateLabel(
                          currentRoom.room.playbackState
                        )}
                      </p>
                      <p className="mt-1">
                        Expires:{' '}
                        {currentRoom.room.expiresAt
                          ? formatTimestamp(currentRoom.room.expiresAt)
                          : 'No expiration set'}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        Media
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {currentRoom.media?.originalFileName ??
                          'Host is still preparing media'}
                      </p>
                      <p className="mt-2">
                        Status:{' '}
                        {currentRoom.media
                          ? getStatusLabel(currentRoom.media.status)
                          : 'Unavailable'}
                      </p>
                      <p className="mt-1">
                        Subtitles: {currentRoom.subtitles.length}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {route.kind === 'home' && selectedMedia.kind === 'idle' && (
              <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-slate-600">
                Pick a recent media item, or paste a secret room link on the
                right to jump into a shared session.
              </div>
            )}

            {route.kind === 'home' && selectedMedia.kind === 'loading' && (
              <div className="mt-6 rounded-[1.5rem] bg-slate-900 p-8 text-white">
                Loading media metadata...
              </div>
            )}

            {route.kind === 'home' && selectedMedia.kind === 'error' && (
              <div className="mt-6 rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-red-700">
                {selectedMedia.message}
              </div>
            )}

            {playbackMedia && canPlayMedia && (
              <div className="mt-6 flex flex-col gap-5">
                <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white shadow-panel">
                  <video
                    className="aspect-video w-full rounded-[1.25rem] bg-black object-contain"
                    controls
                    crossOrigin="anonymous"
                    preload="auto"
                    ref={videoRef}
                  />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0 rounded-[1.5rem] bg-slate-100 p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      Media
                    </p>
                    <p className="mt-2 break-words text-lg font-semibold text-slate-900">
                      {playbackMedia.originalFileName}
                    </p>
                    <p className="mt-2">
                      Status: {getStatusLabel(playbackMedia.status)}
                    </p>
                    <p className="mt-1">
                      Duration: {formatDuration(playbackMedia.durationMs)}
                    </p>
                    <p className="mt-1 break-all">
                      Manifest: {manifestUrl ?? 'Pending'}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        Player
                      </p>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {formatPlayerStateLabel(playerState)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3">
                      <div className="min-w-0 rounded-2xl bg-slate-100 p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Stream
                        </p>
                        <p className="mt-2 break-words font-medium leading-7 text-slate-900">
                          {playerMessage ?? 'Waiting for player setup.'}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-2xl bg-slate-100 p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Sync
                        </p>
                        <p className="mt-2 break-words font-medium leading-7 text-slate-900">
                          {route.kind === 'room'
                            ? (syncMessage ??
                              `Shared playback: ${formatPlaybackStateLabel(currentRoom?.room.playbackState ?? 'paused')}.`)
                            : 'Shared playback activates after joining a room.'}
                        </p>
                      </div>
                      <div className="min-w-0 rounded-2xl bg-slate-100 p-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Subtitles
                        </p>
                        <p className="mt-2 break-words font-medium leading-7 text-slate-900">
                          {subtitleMessage ?? 'Subtitles ready.'}
                        </p>
                      </div>
                    </div>
                    {route.kind === 'room' &&
                      socketState.kind !== 'connected' &&
                      joinState.kind === 'success' && (
                        <button
                          className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                          onClick={retryRealtimeConnection}
                          type="button"
                        >
                          Retry realtime connection
                        </button>
                      )}
                    {playbackMedia.processingError && (
                      <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">
                        {playbackMedia.processingError}
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        Subtitles
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        Track selection
                      </p>
                    </div>
                    {subtitleSaving && (
                      <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 sm:self-auto">
                        Saving...
                      </span>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-center">
                    <select
                      className="min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                      disabled={
                        subtitleState.data.length === 0 || subtitleSaving
                      }
                      onChange={(event) =>
                        void saveSubtitleSelection(
                          event.target.value === '__off__'
                            ? null
                            : event.target.value
                        )
                      }
                      value={selectedSubtitleId ?? '__off__'}
                    >
                      <option value="__off__">Subtitles off</option>
                      {subtitleState.data.map((subtitle) => (
                        <option key={subtitle.id} value={subtitle.id}>
                          {subtitle.label} ({subtitle.format})
                        </option>
                      ))}
                    </select>
                    <p className="max-w-[220px] text-sm leading-6 text-slate-600 xl:justify-self-end">
                      {route.kind === 'room'
                        ? 'Changes sync through the room state.'
                        : 'Open a room to make subtitle selection shared.'}
                    </p>
                  </div>
                  {subtitleState.kind === 'error' && (
                    <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">
                      {subtitleState.message}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-[2rem] bg-ink p-6 text-white shadow-panel">
              <h2 className="text-2xl font-semibold">Backend</h2>
              <p className="mt-3 text-sm text-slate-300">
                API base URL: <span className="font-mono">{apiBaseUrl}</span>
              </p>
              {system.kind === 'success' && (
                <p className="mt-2 text-sm text-slate-300">
                  Realtime path:{' '}
                  <span className="font-mono">{system.data.realtime.path}</span>
                </p>
              )}
              {health.kind === 'success' && (
                <div className="mt-4 rounded-2xl bg-emerald-400/15 p-4 text-emerald-50">
                  <p>Service: {health.data.service}</p>
                  <p className="mt-1">
                    Timestamp: {formatTimestamp(health.data.timestamp)}
                  </p>
                </div>
              )}
              {health.kind === 'error' && (
                <div className="mt-4 rounded-2xl border border-red-300/40 bg-red-500/15 p-4 text-red-100">
                  {health.message}
                </div>
              )}
              {health.kind === 'loading' && (
                <div className="mt-4 rounded-2xl bg-white/10 p-4">
                  Waiting for health endpoint...
                </div>
              )}
              <div className="mt-4 rounded-2xl bg-white/10 p-4">
                <p className="font-medium">Realtime presence</p>
                <p className="mt-2 text-sm">{socketState.message}</p>
                {'socketId' in socketState && (
                  <p className="mt-1 text-sm">
                    Socket ID:{' '}
                    <span className="font-mono">{socketState.socketId}</span>
                  </p>
                )}
              </div>
              {system.kind === 'success' && (
                <>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl bg-white/10 p-4 text-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                        Diagnostics
                      </p>
                      <p className="mt-2">
                        Active rooms: {system.data.diagnostics.activeRooms}
                      </p>
                      <p className="mt-1">
                        Connected participants:{' '}
                        {system.data.diagnostics.connectedParticipants}
                      </p>
                      <p className="mt-1">
                        Active processing jobs:{' '}
                        {system.data.diagnostics.activeProcessingJobs}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-4 text-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                        Cleanup policy
                      </p>
                      <p className="mt-2">
                        Interval: every {system.data.cleanup.intervalMinutes}{' '}
                        min
                      </p>
                      <p className="mt-1">
                        Idle room TTL: {system.data.cleanup.idleRoomTtlMinutes}{' '}
                        min
                      </p>
                      <p className="mt-1">
                        HLS retention: {system.data.cleanup.hlsRetentionHours} h
                      </p>
                    </div>
                  </div>
                  {system.data.cleanup.lastRun && (
                    <div className="mt-4 rounded-2xl bg-white/10 p-4 text-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
                        Last cleanup
                      </p>
                      <p className="mt-2">
                        Finished{' '}
                        {formatTimestamp(
                          system.data.cleanup.lastRun.finishedAt
                        )}
                      </p>
                      <p className="mt-1">
                        Rooms closed:{' '}
                        {system.data.cleanup.lastRun.expiredRoomsClosed +
                          system.data.cleanup.lastRun.idleRoomsClosed}
                      </p>
                      <p className="mt-1">
                        HLS directories removed:{' '}
                        {system.data.cleanup.lastRun.hlsDirectoriesRemoved}
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
              <p className="text-sm uppercase tracking-[0.25em] text-coral">
                Open room
              </p>
              <h2 className="mt-2 font-serif text-3xl">Paste a secret link</h2>
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={handleRoomSubmit}
              >
                <textarea
                  className="min-h-28 rounded-[1.25rem] border border-slate-300 px-4 py-3 text-sm"
                  onChange={(event) => setRoomInput(event.target.value)}
                  placeholder="Paste full room URL or token"
                  value={roomInput}
                />
                <button
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                  type="submit"
                >
                  Open room
                </button>
              </form>
              {notice && (
                <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                  {notice}
                </p>
              )}
            </section>

            {currentRoom && (
              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
                <p className="text-sm uppercase tracking-[0.25em] text-coral">
                  Participants
                </p>
                <h2 className="mt-2 font-serif text-3xl">Room presence</h2>
                <div className="mt-4 flex flex-col gap-3">
                  {currentRoom.participants.map((participant) => (
                    <div
                      className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4"
                      key={participant.id}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {participant.displayName}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            Last seen {formatTimestamp(participant.lastSeenAt)}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">
                          {getParticipantBadge(participant)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
              <p className="text-sm uppercase tracking-[0.25em] text-coral">
                Recent imports
              </p>
              <h2 className="mt-2 font-serif text-3xl">Media queue</h2>
              {recentMedia.kind === 'loading' && (
                <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  Loading media queue...
                </div>
              )}
              {recentMedia.kind === 'error' && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {recentMedia.message}
                </div>
              )}
              {recentMedia.kind === 'success' &&
                recentMedia.data.length === 0 && (
                  <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                    No media has been imported yet.
                  </div>
                )}
              {recentMedia.kind === 'success' &&
                recentMedia.data.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3">
                    {recentMedia.data.map((media) => (
                      <button
                        className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-900 hover:bg-white"
                        key={media.id}
                        onClick={() => navigateHome(media.id)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="font-semibold text-slate-900">
                              {media.originalFileName}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              Imported {formatTimestamp(media.createdAt)}
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">
                            {getStatusLabel(media.status)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

