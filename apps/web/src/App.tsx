import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

import type {
  Media,
  MediaListResponse,
  ServiceHealth,
  SystemStatus
} from '@videoshare/shared-types';
import {
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

const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

function getManifestUrl(media: Pick<Media, 'id' | 'hlsManifestPath'>): string | null {
  if (!media.hlsManifestPath) {
    return null;
  }

  return buildUrlFromBase(apiBaseUrl, `media/${media.id}/${media.hlsManifestPath}`);
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

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [system, setSystem] = useState<SystemState>({ kind: 'loading' });
  const [socketState, setSocketState] = useState<SocketState>({
    kind: 'idle',
    message: 'Waiting for realtime bootstrap...'
  });
  const [recentMedia, setRecentMedia] = useState<RecentMediaState>({
    kind: 'loading'
  });
  const [selectedMediaId, setSelectedMediaId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mediaId');
  });
  const [selectedMedia, setSelectedMedia] = useState<SelectedMediaState>(() =>
    selectedMediaId ? { kind: 'loading' } : { kind: 'idle' }
  );
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
              error instanceof Error ? error.message : 'Unknown network error'
          });
        }
      }
    }

    async function loadSystemStatus() {
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
              error instanceof Error ? error.message : 'Unknown network error'
          });
        }
      }
    }

    void loadHealth();
    void loadSystemStatus();
    const timer = window.setInterval(() => {
      void loadHealth();
      void loadSystemStatus();
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
            message: error instanceof Error ? error.message : 'Unknown media error'
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
    if (system.kind !== 'success') {
      return;
    }

    setSocketState({
      kind: 'connecting',
      message: 'Opening Socket.IO connection...'
    });

    const socket = io(apiBaseUrl, {
      path: system.data.realtime.path,
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      setSocketState({
        kind: 'connected',
        message: 'Realtime handshake established',
        socketId: socket.id ?? 'unknown'
      });
    });

    socket.on('system:hello', (payload: { message?: string }) => {
      setSocketState({
        kind: 'connected',
        message: payload.message ?? 'Realtime handshake established',
        socketId: socket.id ?? 'unknown'
      });
    });

    socket.on('connect_error', (error: Error) => {
      setSocketState({
        kind: 'error',
        message: error.message
      });
    });

    socket.on('disconnect', (reason: string) => {
      setSocketState({
        kind: 'idle',
        message: `Socket disconnected: ${reason}`
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [system.kind === 'success' ? system.data.realtime.path : 'unavailable']);

  useEffect(() => {
    if (!selectedMediaId) {
      setSelectedMedia({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function loadMedia() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media/${selectedMediaId}`);

        if (!response.ok) {
          throw new Error(`Media lookup failed with ${response.status}`);
        }

        const data = (await response.json()) as Media;

        if (cancelled) {
          return;
        }

        setSelectedMedia({ kind: 'success', data });

        if (data.status === 'pending' || data.status === 'processing') {
          timer = window.setTimeout(() => {
            void loadMedia();
          }, 3000);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedMedia({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unknown media error'
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
  }, [selectedMediaId]);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || selectedMedia.kind !== 'success' || !selectedMedia.data.hlsManifestPath) {
      return;
    }

    if (selectedMedia.data.status !== 'ready') {
      video.removeAttribute('src');
      video.load();
      return;
    }

    const manifestUrl = getManifestUrl(selectedMedia.data);

    if (!manifestUrl) {
      setPlayerMessage('Manifest will appear after processing completes.');
      return;
    }
    let cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    let cancelled = false;

    setPlayerMessage('Attaching HLS stream...');

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = manifestUrl;
      setPlayerMessage('Using the browser native HLS playback path.');
      return cleanup;
    }

    void loadHlsConstructor()
      .then((Hls) => {
        if (cancelled) {
          return;
        }

        if (!Hls || !Hls.isSupported()) {
          setPlayerMessage(
            'This browser could not initialize HLS playback. Try Safari or open the manifest URL directly.'
          );
          return;
        }

        const hls = new Hls();
        hls.loadSource(manifestUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setPlayerMessage('HLS manifest loaded. Playback should be ready.');
        });
        hls.on(Hls.Events.ERROR, (_eventName: unknown, rawData: unknown) => {
          const data = rawData as HlsErrorData;
          if (data.fatal) {
            setPlayerMessage(
              data.details
                ? `Playback hit a fatal HLS error: ${data.details}`
                : 'Playback hit a fatal HLS error.'
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
          setPlayerMessage(
            error instanceof Error
              ? error.message
              : 'Failed to load the HLS playback library'
          );
        }
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [selectedMedia]);

  const selectedMediaData = selectedMedia.kind === 'success' ? selectedMedia.data : null;
  const manifestUrl = selectedMediaData ? getManifestUrl(selectedMediaData) : null;

  function openMedia(mediaId: string) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('mediaId', mediaId);
    window.history.replaceState({}, '', nextUrl);
    setSelectedMediaId(mediaId);
  }

  function clearSelection() {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('mediaId');
    window.history.replaceState({}, '', nextUrl);
    setSelectedMediaId(null);
    setPlayerMessage(null);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7d8,_#fffaf1_42%,_#d9f0ff)] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-panel backdrop-blur">
          <p className="text-sm uppercase tracking-[0.35em] text-coral">
            Phase 2
          </p>
          <h1 className="mt-4 max-w-4xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Media import, HLS processing, and browser playback are now wired into the app shell.
          </h1>
          <p className="mt-4 max-w-3xl text-lg text-slate-600">
            Use the desktop host to import a local movie, then open this page with a <span className="font-mono">mediaId</span> to watch processing progress and play the generated stream.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-coral">
                  Stream Preview
                </p>
                <h2 className="mt-2 font-serif text-3xl">Browser playback surface</h2>
              </div>
              {selectedMediaData && (
                <button
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
                  onClick={clearSelection}
                  type="button"
                >
                  Clear selection
                </button>
              )}
            </div>

            {selectedMedia.kind === 'idle' && (
              <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-slate-600">
                Pick a recently imported media item below, or open this page with <span className="font-mono">?mediaId=&lt;id&gt;</span>.
              </div>
            )}

            {selectedMedia.kind === 'loading' && (
              <div className="mt-6 rounded-[1.5rem] bg-slate-900 p-8 text-white">
                Loading media metadata and processing state...
              </div>
            )}

            {selectedMedia.kind === 'error' && (
              <div className="mt-6 rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-red-700">
                {selectedMedia.message}
              </div>
            )}

            {selectedMediaData && (
              <div className="mt-6 flex flex-col gap-5">
                <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white shadow-panel">
                  <video
                    className="aspect-video w-full rounded-[1.25rem] bg-black object-contain"
                    controls
                    ref={videoRef}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-slate-100 p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      File
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">
                      {selectedMediaData.originalFileName}
                    </p>
                    <p className="mt-2">Status: {getStatusLabel(selectedMediaData.status)}</p>
                    <p className="mt-1">Duration: {formatDuration(selectedMediaData.durationMs)}</p>
                    <p className="mt-1">
                      Video: {selectedMediaData.videoCodec ?? 'Unknown'}
                      {selectedMediaData.width && selectedMediaData.height
                        ? ` • ${selectedMediaData.width}x${selectedMediaData.height}`
                        : ''}
                    </p>
                    <p className="mt-1">Audio: {selectedMediaData.audioCodec ?? 'Unknown'}</p>
                  </div>

                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-700">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      Playback
                    </p>
                    <p className="mt-2 break-all font-mono text-[13px] text-slate-900">
                      {manifestUrl ?? 'Manifest will appear after processing completes.'}
                    </p>
                    <p className="mt-3 text-slate-600">
                      {playerMessage ?? 'Waiting for the player to initialize.'}
                    </p>
                    {selectedMediaData.processingError && (
                      <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700">
                        {selectedMediaData.processingError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <section className="rounded-[2rem] bg-ink p-6 text-white shadow-panel">
              <h2 className="text-2xl font-semibold">Backend connectivity</h2>
              <p className="mt-3 text-sm text-slate-300">
                API base URL: <span className="font-mono">{apiBaseUrl}</span>
              </p>

              {health.kind === 'loading' && (
                <div className="mt-5 rounded-2xl bg-white/10 p-4">
                  Waiting for the local backend health endpoint...
                </div>
              )}

              {health.kind === 'error' && (
                <div className="mt-5 rounded-2xl border border-red-300/40 bg-red-500/15 p-4 text-red-100">
                  {health.message}
                </div>
              )}

              {health.kind === 'success' && (
                <div className="mt-5 rounded-2xl bg-emerald-400/15 p-4 text-emerald-50">
                  <p>Service: {health.data.service}</p>
                  <p className="mt-1">Uptime: {health.data.uptimeSeconds}s</p>
                  <p className="mt-1">Timestamp: {formatTimestamp(health.data.timestamp)}</p>
                </div>
              )}

              <div className="mt-5 rounded-2xl bg-white/10 p-4">
                <p className="font-medium">Realtime handshake</p>
                <p className="mt-2 text-sm">{socketState.message}</p>
                {'socketId' in socketState && (
                  <p className="mt-1 text-sm">
                    Socket ID: <span className="font-mono">{socketState.socketId}</span>
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-panel">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-coral">
                    Recent imports
                  </p>
                  <h2 className="mt-2 font-serif text-3xl">Media queue</h2>
                </div>
                {system.kind === 'success' && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {system.data.realtime.status}
                  </span>
                )}
              </div>

              {recentMedia.kind === 'loading' && (
                <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  Loading media queue...
                </div>
              )}

              {recentMedia.kind === 'error' && (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {recentMedia.message}
                </div>
              )}

              {recentMedia.kind === 'success' && recentMedia.data.length === 0 && (
                <div className="mt-5 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  No media has been imported yet. Use the desktop host to upload your first movie.
                </div>
              )}

              {recentMedia.kind === 'success' && recentMedia.data.length > 0 && (
                <div className="mt-5 flex flex-col gap-3">
                  {recentMedia.data.map((media) => (
                    <button
                      className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-900 hover:bg-white"
                      key={media.id}
                      onClick={() => openMedia(media.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900">{media.originalFileName}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            Imported {formatTimestamp(media.createdAt)}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
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
