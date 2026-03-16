import { type FormEvent, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import type {
  Media,
  MediaListResponse,
  MediaSubtitlesResponse,
  Participant,
  PlaybackResyncEvent,
  PlaybackState,
  PlaybackStateReportPayload,
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
  | { kind: 'room'; token: string };

type RealtimeErrorPayload = {
  message?: string;
  statusCode?: number;
};

const PLAYBACK_GUARD_WINDOW_MS = 250;
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

function mergeRoomPlayback(current: RoomLookupResponse, room: Room): RoomLookupResponse {
  return {
    ...current,
    room
  };
}

function formatPlaybackStateLabel(value: PlaybackState): string {
  return value === 'playing' ? 'Playing' : 'Paused';
}

const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const appBasePath = (() => {
  const configuredBase = import.meta.env.BASE_URL ?? '/';
  if (configuredBase === '/') {
    return '';
  }
  return configuredBase.endsWith('/') ? configuredBase.slice(0, -1) : configuredBase;
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
  const pathname = stripAppBasePath(currentUrl.pathname).replace(/\/+$/, '') || '/';
  const segments = pathname.split('/').filter(Boolean);
  const legacyToken = currentUrl.searchParams.get('roomToken');

  if (segments[0] === 'room' && segments[1]) {
    return { kind: 'room', token: decodeURIComponent(segments.slice(1).join('/')) };
  }

  if (legacyToken) {
    return { kind: 'room', token: legacyToken };
  }

  return {
    kind: 'home',
    mediaId: currentUrl.searchParams.get('mediaId')
  };
}

function getManifestUrl(media: Pick<Media, 'id' | 'hlsManifestPath'>): string | null {
  if (!media.hlsManifestPath) {
    return null;
  }
  return buildUrlFromBase(apiBaseUrl, `media/${media.id}/${media.hlsManifestPath}`);
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
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
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
  const stateLabel = participant.connectionState === 'connected' ? 'online' : 'offline';
  return `${roleLabel} ${stateLabel}`;
}

function isSameMedia(left: Media, right: Media): boolean {
  return left.id === right.id && left.status === right.status && left.hlsManifestPath === right.hlsManifestPath && left.processingError === right.processingError && left.durationMs === right.durationMs;
}

function isSameSubtitleList(left: Subtitle[], right: Subtitle[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((subtitle, index) => {
    const other = right[index];
    return subtitle.id === other?.id && subtitle.label === other?.label && subtitle.format === other?.format && subtitle.isDefault === other?.isDefault;
  });
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? `${fallback} (${response.status})`;
}

function getStoredParticipantId(token: string): string | null {
  try {
    return window.localStorage.getItem(`videoshare:room:${token}:participantId`);
  } catch {
    return null;
  }
}

function getStoredDisplayName(token: string): string {
  try {
    return window.localStorage.getItem(`videoshare:room:${token}:displayName`) ?? 'Guest';
  } catch {
    return 'Guest';
  }
}

function saveParticipantSession(token: string, participantId: string, displayName: string): void {
  try {
    window.localStorage.setItem(`videoshare:room:${token}:participantId`, participantId);
    window.localStorage.setItem(`videoshare:room:${token}:displayName`, displayName);
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

function extractRoomToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (segments[segments.length - 2] === 'room' && segments[segments.length - 1]) {
      return decodeURIComponent(segments[segments.length - 1]);
    }
  } catch {
    return trimmed.replace(/^\/+|\/+$/g, '');
  }

  return trimmed;
}

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => parseRouteFromLocation());
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [system, setSystem] = useState<SystemState>({ kind: 'loading' });
  const [socketState, setSocketState] = useState<SocketState>({ kind: 'idle', message: 'Join a room to activate realtime presence.' });
  const [recentMedia, setRecentMedia] = useState<RecentMediaState>({ kind: 'loading' });
  const [selectedMedia, setSelectedMedia] = useState<SelectedMediaState>({ kind: 'idle' });
  const [roomState, setRoomState] = useState<RoomState>({ kind: 'idle' });
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });
  const [subtitleState, setSubtitleState] = useState<SubtitleState>({ kind: 'idle', data: [] });
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [subtitleMessage, setSubtitleMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [subtitleSaving, setSubtitleSaving] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState('Guest');
  const [notice, setNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const autoJoinTokenRef = useRef<string | null>(null);
  const playbackGuardTimerRef = useRef<number | null>(null);
  const softResyncTimerRef = useRef<number | null>(null);
  const suppressPlaybackEventsRef = useRef(false);
  const lastAppliedPlaybackSignatureRef = useRef<string | null>(null);
  const roomToken = route.kind === 'room' ? route.token : null;
  const mediaId = route.kind === 'home' ? route.mediaId : null;

  function armPlaybackGuard() {
    suppressPlaybackEventsRef.current = true;

    if (playbackGuardTimerRef.current) {
      window.clearTimeout(playbackGuardTimerRef.current);
    }

    playbackGuardTimerRef.current = window.setTimeout(() => {
      suppressPlaybackEventsRef.current = false;
      playbackGuardTimerRef.current = null;
    }, PLAYBACK_GUARD_WINDOW_MS);
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
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const driftMs = options?.driftMs ?? Math.round((targetTime - currentTime) * 1000);
    const needsHardSync = options?.mode === 'hard'
      || room.playbackState === 'paused'
      || Math.abs(driftMs) >= 1500;

    armPlaybackGuard();
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
      video.currentTime = Math.max(0, targetTime);
    }

    if (room.playbackState === 'playing') {
      video.playbackRate = targetRate;
      if (!needsHardSync && options?.mode === 'soft') {
        video.playbackRate = driftMs > 0
          ? Math.min(targetRate + 0.08, 1.15)
          : Math.max(targetRate - 0.08, 0.85);
        softResyncTimerRef.current = window.setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.playbackRate = targetRate;
          }
          softResyncTimerRef.current = null;
        }, SOFT_RESYNC_WINDOW_MS);
      }

      void video.play().catch(() => {
        setSyncMessage('Shared playback is waiting for a local play interaction.');
      });
    } else {
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
      setDisplayNameInput(getStoredDisplayName(route.token));
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
  }, [mediaId]);

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
          setHealth({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown health error' });
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
          setSystem({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown system error' });
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
          setRecentMedia({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown media error' });
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
          const message = await readErrorMessage(response, 'Room lookup failed');
          if (!cancelled) {
            setRoomState({ kind: 'error', message, statusCode: response.status });
          }
          if (response.status !== 404 && response.status !== 410 && !cancelled) {
            timer = window.setTimeout(() => void loadRoom(), 5000);
          }
          return;
        }

        const data = (await response.json()) as RoomLookupResponse;
        if (cancelled) {
          return;
        }

        setRoomState({ kind: 'success', data });
        setSubtitleState((current) => {
          if (isSameSubtitleList(current.data, data.subtitles)) {
            return current.kind === 'success' ? current : { kind: 'success', data: current.data };
          }
          return { kind: 'success', data: data.subtitles };
        });
        setSelectedSubtitleId(data.room.activeSubtitleId);
        timer = window.setTimeout(() => void loadRoom(), 10000);
      } catch (error) {
        if (!cancelled) {
          setRoomState({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown room error' });
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
  }, [roomToken]);

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
          throw new Error(await readErrorMessage(response, 'Media lookup failed'));
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
          setSelectedMedia({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown media error' });
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
        const response = await fetch(`${apiBaseUrl}/api/media/${mediaId}/subtitles`);
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, 'Subtitle lookup failed'));
        }
        const data = (await response.json()) as MediaSubtitlesResponse;
        if (!cancelled) {
          setSubtitleState({ kind: 'success', data: data.subtitles });
          setSelectedSubtitleId((current) => current ?? data.subtitles.find((subtitle) => subtitle.isDefault)?.id ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setSubtitleState({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown subtitle error', data: [] });
        }
      }
    }

    void loadSubtitles();
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  useEffect(() => {
    if (route.kind !== 'room' || roomState.kind !== 'success' || joinState.kind === 'success' || joinState.kind === 'joining') {
      return;
    }

    const storedParticipantId = roomToken ? getStoredParticipantId(roomToken) : null;
    if (!storedParticipantId || autoJoinTokenRef.current === roomToken) {
      return;
    }

    autoJoinTokenRef.current = roomToken;
    void joinRoom(displayNameInput, storedParticipantId, true);
  }, [
    displayNameInput,
    joinState.kind,
    roomState.kind === 'success' ? roomState.data.room.token : 'idle',
    roomToken ?? 'home'
  ]);

  useEffect(() => {
    if (route.kind !== 'room' || roomState.kind !== 'success' || joinState.kind !== 'success') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketState({ kind: 'idle', message: 'Join a room to activate realtime presence.' });
      return;
    }

    setSocketState({ kind: 'connecting', message: 'Opening realtime room presence...' });

    const socket = io(apiBaseUrl, {
      path: roomState.data.socketPath,
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketState({ kind: 'connecting', message: 'Socket connected. Joining room...' });
      socket.emit('room:join', {
        token: roomToken,
        participantId: joinState.participant.id
      });
    });

    socket.on('room:joined', (payload: { participant: Participant; room: RoomLookupResponse['room']; participants: Participant[] }) => {
      setJoinState({ kind: 'success', participant: payload.participant });
      setSocketState({ kind: 'connected', message: 'Realtime presence active.', socketId: socket.id ?? 'unknown' });
      setRoomState((current) => current.kind === 'success'
        ? { kind: 'success', data: { ...current.data, room: payload.room, participants: payload.participants } }
        : current);
    });

    socket.on('room:state', (payload: RoomLookupResponse) => {
      setRoomState({ kind: 'success', data: payload });
      setSubtitleState({ kind: 'success', data: payload.subtitles });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
    });

    socket.on('playback:update', (payload: PlaybackUpdateEvent) => {
      setRoomState((current) => current.kind === 'success'
        ? { kind: 'success', data: mergeRoomPlayback(current.data, payload.room) }
        : current);
      setSyncMessage(payload.reason === 'seek'
        ? 'Received a shared seek update.'
        : payload.reason === 'play'
          ? 'Received a shared play update.'
          : 'Received a shared pause update.');
    });

    socket.on('playback:resync', (payload: PlaybackResyncEvent) => {
      lastAppliedPlaybackSignatureRef.current = getPlaybackSignature(payload.room);
      setRoomState((current) => current.kind === 'success'
        ? { kind: 'success', data: mergeRoomPlayback(current.data, payload.room) }
        : current);
      applyPlaybackRoom(payload.room, {
        mode: payload.mode,
        driftMs: payload.driftMs
      });
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
      if (payload.statusCode === 403 || payload.statusCode === 410) {
        if (roomToken) {
          clearParticipantSession(roomToken);
        }
        setJoinState({ kind: 'error', message });
      }
    });

    socket.on('connect_error', (error: Error) => {
      setSocketState({ kind: 'error', message: error.message });
    });

    socket.on('disconnect', (reason: string) => {
      setSocketState({ kind: 'idle', message: `Socket disconnected: ${reason}` });
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

  useEffect(() => {
    if (route.kind !== 'room' || joinState.kind !== 'success') {
      return;
    }

    const activeRoomToken = route.token;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const socket = socketRef.current;

      if (!video || !socket || socket.disconnected || video.readyState < 2) {
        return;
      }

      const payload: PlaybackStateReportPayload = {
        token: activeRoomToken,
        participantId: joinState.participant.id,
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        playbackState: video.paused ? 'paused' : 'playing',
        playbackRate: video.playbackRate || 1
      };

      socket.emit('playback:state-report', payload);
    }, 4000);

    return () => window.clearInterval(timer);
  }, [
    joinState.kind,
    joinState.kind === 'success' ? joinState.participant.id : 'idle',
    roomToken ?? 'home',
    route.kind
  ]);

  const playbackMedia = route.kind === 'room'
    ? roomState.kind === 'success' ? roomState.data.media : null
    : selectedMedia.kind === 'success' ? selectedMedia.data : null;
  const canPlayMedia = route.kind === 'home' || joinState.kind === 'success';

  useEffect(() => {
    if (route.kind !== 'room' || joinState.kind !== 'success' || roomState.kind !== 'success') {
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
    roomState.kind === 'success' ? roomState.data.room.lastStateUpdatedAt : 'idle',
    route.kind
  ]);

  useEffect(() => {
    if (route.kind !== 'room' || joinState.kind !== 'success') {
      clearSoftResyncTimer();
      suppressPlaybackEventsRef.current = false;
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    const activeVideo = video;
    const activeParticipantId = joinState.participant.id;
    const activeRoomToken = route.token;

    function emitPlaybackEvent(eventName: 'playback:play' | 'playback:pause' | 'playback:seek') {
      if (suppressPlaybackEventsRef.current) {
        return;
      }

      const socket = socketRef.current;
      if (!socket || socket.disconnected) {
        return;
      }

      socket.emit(eventName, {
        token: activeRoomToken,
        participantId: activeParticipantId,
        currentTime: Number.isFinite(activeVideo.currentTime) ? activeVideo.currentTime : 0,
        playbackRate: activeVideo.playbackRate || 1
      });
    }

    const handlePlay = () => emitPlaybackEvent('playback:play');
    const handlePause = () => emitPlaybackEvent('playback:pause');
    const handleSeeked = () => emitPlaybackEvent('playback:seek');

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

  useEffect(() => () => {
    clearSoftResyncTimer();
    if (playbackGuardTimerRef.current) {
      window.clearTimeout(playbackGuardTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (!canPlayMedia) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      setPlayerMessage('Join the room to unlock playback.');
      return;
    }

    if (!playbackMedia || !playbackMedia.hlsManifestPath) {
      return;
    }

    if (playbackMedia.status !== 'ready') {
      video.removeAttribute('src');
      video.load();
      setPlayerMessage('Manifest will appear after processing completes.');
      return;
    }

    const manifestUrl = getManifestUrl(playbackMedia);
    if (!manifestUrl) {
      return;
    }

    let cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    let cancelled = false;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      setPlayerMessage('Using native HLS playback.');
      return cleanup;
    }

    void loadHlsConstructor().then((Hls) => {
      if (cancelled) {
        return;
      }
      if (!Hls || !Hls.isSupported()) {
        setPlayerMessage('This browser could not initialize HLS playback.');
        return;
      }

      const hls = new Hls();
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setPlayerMessage('HLS manifest loaded.'));
      hls.on(Hls.Events.ERROR, (_eventName: unknown, rawData: unknown) => {
        const data = rawData as HlsErrorData;
        if (data.fatal) {
          setPlayerMessage(data.details ? `Fatal HLS error: ${data.details}` : 'Fatal HLS error.');
        }
      });

      cleanup = () => {
        hls.destroy();
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }).catch((error) => {
      if (!cancelled) {
        setPlayerMessage(error instanceof Error ? error.message : 'Failed to load HLS support');
      }
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [canPlayMedia, playbackMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    Array.from(video.querySelectorAll('track[data-managed-subtitle="true"]')).forEach((track) => track.remove());

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
        track.track.mode = subtitle.id === selectedSubtitleId ? 'showing' : 'disabled';
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

    const trackElements = Array.from(video.querySelectorAll('track[data-managed-subtitle="true"]'));
    const trackIndex = trackElements.findIndex((track) => track.getAttribute('data-subtitle-id') === selectedSubtitleId);
    const matchingTrack = trackIndex >= 0 ? video.textTracks[trackIndex] : null;

    if (matchingTrack) {
      matchingTrack.mode = 'showing';
      const subtitle = subtitleState.data.find((item) => item.id === selectedSubtitleId);
      setSubtitleMessage(`Showing subtitle: ${subtitle?.label ?? 'Unknown track'}`);
      return;
    }

    setSubtitleMessage('Subtitle track is still loading.');
  }, [selectedSubtitleId, subtitleState.data]);

  const manifestUrl = playbackMedia ? getManifestUrl(playbackMedia) : null;
  const currentRoom = roomState.kind === 'success' ? roomState.data : null;

  async function joinRoom(displayName: string, participantId?: string | null, silent = false) {
    if (route.kind !== 'room') {
      return;
    }

    const nextDisplayName = displayName.trim() || 'Guest';
    try {
      setJoinState({ kind: 'joining' });
      if (!silent) {
        setNotice('Joining the room...');
      }

      const response = await fetch(`${apiBaseUrl}/api/rooms/${route.token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: nextDisplayName, participantId: participantId ?? undefined })
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Room join failed'));
      }

      const payload = (await response.json()) as RoomJoinResponse;
      saveParticipantSession(route.token, payload.participant.id, nextDisplayName);
      setJoinState({ kind: 'success', participant: payload.participant });
      setRoomState({ kind: 'success', data: payload });
      setSubtitleState({ kind: 'success', data: payload.subtitles });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
      setNotice(`Joined as ${payload.participant.displayName}.`);
    } catch (error) {
      if (participantId) {
        if (roomToken) {
          clearParticipantSession(roomToken);
        }
      }
      setJoinState({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to join room' });
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
      const response = await fetch(`${apiBaseUrl}/api/rooms/${route.token}/subtitle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeSubtitleId: nextSubtitleId })
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Subtitle update failed'));
      }
      const payload = (await response.json()) as RoomLookupResponse;
      setRoomState({ kind: 'success', data: payload });
      setSubtitleState({ kind: 'success', data: payload.subtitles });
      setSelectedSubtitleId(payload.room.activeSubtitleId);
    } catch (error) {
      setSubtitleMessage(error instanceof Error ? error.message : 'Failed to save subtitle selection');
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

  function openRoom(token: string) {
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = buildAppPath(`/room/${encodeURIComponent(token)}`);
    nextUrl.search = '';
    window.history.pushState({}, '', nextUrl);
    setRoute({ kind: 'room', token });
  }

  function handleRoomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = extractRoomToken(roomInput);
    if (!token) {
      setNotice('Paste a full room URL or token first.');
      return;
    }
    openRoom(token);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7d8,_#fffaf1_42%,_#d9f0ff)] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
          <p className="text-sm uppercase tracking-[0.35em] text-coral">Phase 5</p>
          <h1 className="mt-4 font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Room playback is now authoritative on the server with synchronized play, pause, seek, and drift correction.
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-slate-600">
            Use <span className="font-mono">/room/&lt;token&gt;</span> to join a private session, recover playback state after reconnects, and keep both viewers aligned through realtime sync.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-coral">{route.kind === 'room' ? 'Room' : 'Preview'}</p>
                <h2 className="mt-2 font-serif text-3xl">{route.kind === 'room' ? 'Private watch room' : 'Browser playback'}</h2>
              </div>
              {route.kind === 'room' ? (
                <button className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700" onClick={() => navigateHome(null)} type="button">
                  Back to landing
                </button>
              ) : playbackMedia ? (
                <button className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700" onClick={() => navigateHome(null)} type="button">
                  Clear selection
                </button>
              ) : null}
            </div>

            {route.kind === 'room' && roomState.kind === 'loading' && (
              <div className="mt-6 rounded-[1.5rem] bg-slate-900 p-8 text-white">Validating room token and loading room metadata...</div>
            )}

            {route.kind === 'room' && roomState.kind === 'error' && (
              <div className="mt-6 rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-red-700">
                <p className="text-lg font-semibold">{roomState.statusCode === 410 ? 'This room is no longer available.' : 'This room could not be opened.'}</p>
                <p className="mt-2">{roomState.message}</p>
              </div>
            )}

            {route.kind === 'room' && currentRoom && joinState.kind !== 'success' && roomState.kind === 'success' && (
              <div className="mt-6 flex flex-col gap-4">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Join room</p>
                  <form className="mt-4 flex flex-col gap-3 md:flex-row" onSubmit={(event) => {
                    event.preventDefault();
                    void joinRoom(displayNameInput);
                  }}>
                    <input className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm" maxLength={48} onChange={(event) => setDisplayNameInput(event.target.value)} value={displayNameInput} />
                    <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:bg-slate-400" disabled={joinState.kind === 'joining'} type="submit">
                      {joinState.kind === 'joining' ? 'Joining...' : 'Join room'}
                    </button>
                  </form>
                  {joinState.kind === 'error' && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{joinState.message}</p>}
                  {notice && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-slate-100 p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Room info</p>
                    <p className="mt-2 break-all font-mono text-[13px] text-slate-900">{currentRoom.shareUrl}</p>
                    <p className="mt-2">Status: {currentRoom.room.status}</p>
                    <p className="mt-1">Playback: {formatPlaybackStateLabel(currentRoom.room.playbackState)}</p>
                    <p className="mt-1">Expires: {currentRoom.room.expiresAt ? formatTimestamp(currentRoom.room.expiresAt) : 'No expiration set'}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Media</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{currentRoom.media?.originalFileName ?? 'Host is still preparing media'}</p>
                    <p className="mt-2">Status: {currentRoom.media ? getStatusLabel(currentRoom.media.status) : 'Unavailable'}</p>
                    <p className="mt-1">Subtitles: {currentRoom.subtitles.length}</p>
                  </div>
                </div>
              </div>
            )}

            {route.kind === 'home' && selectedMedia.kind === 'idle' && (
              <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-slate-600">
                Pick a recent media item, or paste a secret room link on the right to jump into a shared session.
              </div>
            )}

            {route.kind === 'home' && selectedMedia.kind === 'loading' && (
              <div className="mt-6 rounded-[1.5rem] bg-slate-900 p-8 text-white">Loading media metadata...</div>
            )}

            {route.kind === 'home' && selectedMedia.kind === 'error' && (
              <div className="mt-6 rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-red-700">{selectedMedia.message}</div>
            )}

            {playbackMedia && canPlayMedia && (
              <div className="mt-6 flex flex-col gap-5">
                <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white shadow-panel">
                  <video className="aspect-video w-full rounded-[1.25rem] bg-black object-contain" controls crossOrigin="anonymous" ref={videoRef} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-slate-100 p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Media</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{playbackMedia.originalFileName}</p>
                    <p className="mt-2">Status: {getStatusLabel(playbackMedia.status)}</p>
                    <p className="mt-1">Duration: {formatDuration(playbackMedia.durationMs)}</p>
                    <p className="mt-1">Manifest: {manifestUrl ?? 'Pending'}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Player</p>
                    <p className="mt-2">{playerMessage ?? 'Waiting for player setup.'}</p>
                    <p className="mt-2">{subtitleMessage ?? 'Subtitles ready.'}</p>
                    <p className="mt-2">{route.kind === 'room' ? (syncMessage ?? `Shared playback: ${formatPlaybackStateLabel(currentRoom?.room.playbackState ?? 'paused')}.`) : 'Shared playback activates after joining a room.'}</p>
                    {playbackMedia.processingError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">{playbackMedia.processingError}</p>}
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Subtitles</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">Track selection</p>
                    </div>
                    {subtitleSaving && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Saving...</span>}
                  </div>
                  <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                    <select className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" disabled={subtitleState.data.length === 0 || subtitleSaving} onChange={(event) => void saveSubtitleSelection(event.target.value === '__off__' ? null : event.target.value)} value={selectedSubtitleId ?? '__off__'}>
                      <option value="__off__">Subtitles off</option>
                      {subtitleState.data.map((subtitle) => <option key={subtitle.id} value={subtitle.id}>{subtitle.label} ({subtitle.format})</option>)}
                    </select>
                    <p className="text-sm text-slate-600">{route.kind === 'room' ? 'Changes sync through the room state.' : 'Open a room to make subtitle selection shared.'}</p>
                  </div>
                  {subtitleState.kind === 'error' && <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">{subtitleState.message}</p>}
                </div>
              </div>
            )}
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-[2rem] bg-ink p-6 text-white shadow-panel">
              <h2 className="text-2xl font-semibold">Backend</h2>
              <p className="mt-3 text-sm text-slate-300">API base URL: <span className="font-mono">{apiBaseUrl}</span></p>
              {system.kind === 'success' && <p className="mt-2 text-sm text-slate-300">Realtime path: <span className="font-mono">{system.data.realtime.path}</span></p>}
              {health.kind === 'success' && <div className="mt-4 rounded-2xl bg-emerald-400/15 p-4 text-emerald-50"><p>Service: {health.data.service}</p><p className="mt-1">Timestamp: {formatTimestamp(health.data.timestamp)}</p></div>}
              {health.kind === 'error' && <div className="mt-4 rounded-2xl border border-red-300/40 bg-red-500/15 p-4 text-red-100">{health.message}</div>}
              {health.kind === 'loading' && <div className="mt-4 rounded-2xl bg-white/10 p-4">Waiting for health endpoint...</div>}
              <div className="mt-4 rounded-2xl bg-white/10 p-4"><p className="font-medium">Realtime presence</p><p className="mt-2 text-sm">{socketState.message}</p>{'socketId' in socketState && <p className="mt-1 text-sm">Socket ID: <span className="font-mono">{socketState.socketId}</span></p>}</div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
              <p className="text-sm uppercase tracking-[0.25em] text-coral">Open room</p>
              <h2 className="mt-2 font-serif text-3xl">Paste a secret link</h2>
              <form className="mt-4 flex flex-col gap-3" onSubmit={handleRoomSubmit}>
                <textarea className="min-h-28 rounded-[1.25rem] border border-slate-300 px-4 py-3 text-sm" onChange={(event) => setRoomInput(event.target.value)} placeholder="Paste full room URL or token" value={roomInput} />
                <button className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white" type="submit">Open room</button>
              </form>
              {notice && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}
            </section>

            {currentRoom && (
              <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
                <p className="text-sm uppercase tracking-[0.25em] text-coral">Participants</p>
                <h2 className="mt-2 font-serif text-3xl">Room presence</h2>
                <div className="mt-4 flex flex-col gap-3">
                  {currentRoom.participants.map((participant) => (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4" key={participant.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{participant.displayName}</p>
                          <p className="mt-1 text-sm text-slate-600">Last seen {formatTimestamp(participant.lastSeenAt)}</p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">{getParticipantBadge(participant)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
              <p className="text-sm uppercase tracking-[0.25em] text-coral">Recent imports</p>
              <h2 className="mt-2 font-serif text-3xl">Media queue</h2>
              {recentMedia.kind === 'loading' && <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">Loading media queue...</div>}
              {recentMedia.kind === 'error' && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{recentMedia.message}</div>}
              {recentMedia.kind === 'success' && recentMedia.data.length === 0 && <div className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">No media has been imported yet.</div>}
              {recentMedia.kind === 'success' && recentMedia.data.length > 0 && <div className="mt-4 flex flex-col gap-3">{recentMedia.data.map((media) => <button className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-900 hover:bg-white" key={media.id} onClick={() => navigateHome(media.id)} type="button"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold text-slate-900">{media.originalFileName}</p><p className="mt-1 text-sm text-slate-600">Imported {formatTimestamp(media.createdAt)}</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700">{getStatusLabel(media.status)}</span></div></button>)}</div>}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}


























