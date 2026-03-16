import { useEffect, useRef, useState } from 'react';

import type {
  DesktopStatus,
  Media,
  MediaListResponse,
  MediaOperationResponse,
  RoomLookupResponse,
  Subtitle,
  SubtitleOperationResponse
} from '@videoshare/shared-types';

type UploadState = 'idle' | 'uploading' | 'error' | 'success';

type RecentMediaState =
  | { kind: 'loading'; data: Media[] }
  | { kind: 'error'; data: Media[]; message: string }
  | { kind: 'success'; data: Media[] };

const showDebugUrls = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_DEBUG_URLS ?? '').toLowerCase()
);

const fallbackStatus: DesktopStatus = {
  apiBaseUrl: 'http://localhost:3000',
  webUrl: 'http://localhost:5173',
  lanApiBaseUrl: null,
  lanWebUrl: null,
  tauri: 'ready'
};

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

function getStatusText(status: Media['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting for FFmpeg pipeline';
    case 'processing':
      return 'Running ffprobe and generating HLS';
    case 'ready':
      return 'Ready for browser playback';
    case 'error':
      return 'Processing failed';
    default:
      return status;
  }
}

function buildPlayerUrl(baseUrl: string, mediaId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('mediaId', mediaId);
  return url.toString();
}

function buildRoomPlayerUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  url.pathname = `${normalizedPath}room/${token}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function formatImportedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const deletingMediaIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSubtitleFile, setSelectedSubtitleFile] = useState<File | null>(null);
  const [selectedRoomSubtitleId, setSelectedRoomSubtitleId] = useState<string | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [room, setRoom] = useState<RoomLookupResponse | null>(null);
  const [recentMedia, setRecentMedia] = useState<RecentMediaState>({
    kind: 'loading',
    data: []
  });
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [subtitleUploadState, setSubtitleUploadState] = useState<UploadState>('idle');
  const [roomState, setRoomState] = useState<UploadState>('idle');
  const [roomSubtitleState, setRoomSubtitleState] = useState<UploadState>('idle');
  const [deleteState, setDeleteState] = useState<UploadState>('idle');
  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);
  const [processingQueued, setProcessingQueued] = useState(false);
  const [hostDisplayName, setHostDisplayName] = useState('Host');
  const [roomExpiryHours, setRoomExpiryHours] = useState('24');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDesktopStatus() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const nextStatus = await invoke<DesktopStatus>('get_local_status');

        if (!cancelled) {
          setStatus(nextStatus);
        }
      } catch (reason) {
        if (!cancelled) {
          setStatus(fallbackStatus);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }

    void loadDesktopStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!status) {
      return;
    }

    let cancelled = false;
    const apiBaseUrl = status.apiBaseUrl;

    async function loadRecentMedia() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media`);

        if (!response.ok) {
          throw new Error(`Media list failed with ${response.status}`);
        }

        const payload = (await response.json()) as MediaListResponse;

        if (!cancelled) {
          setRecentMedia({ kind: 'success', data: payload.media });
        }
      } catch (reason) {
        if (!cancelled) {
          setRecentMedia((current) => ({
            kind: 'error',
            data: current.data,
            message: reason instanceof Error ? reason.message : 'Failed to load recent media'
          }));
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
  }, [status]);

  useEffect(() => {
    if (!status || !media || (media.status !== 'pending' && media.status !== 'processing')) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(`${status.apiBaseUrl}/api/media/${media.id}`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Media lookup failed with ${response.status}`);
          }

          return (await response.json()) as Media;
        })
        .then((nextMedia) => {
          if (!cancelled) {
            setMedia(nextMedia);
            if (nextMedia.status === 'ready') {
              setMessage('HLS output is ready. You can open the browser preview now.');
              setUploadState('success');
            }
            if (nextMedia.status === 'error') {
              setUploadState('error');
              setError(nextMedia.processingError ?? 'Media processing failed');
            }
          }
        })
        .catch((reason) => {
          if (!cancelled) {
            setUploadState('error');
            setError(reason instanceof Error ? reason.message : 'Failed to refresh media status');
          }
        });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, media]);

  useEffect(() => {
    if (!status || !media) {
      return;
    }

    let cancelled = false;
    const apiBaseUrl = status.apiBaseUrl;
    const mediaId = media.id;

    async function loadSubtitles() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media/${mediaId}/subtitles`);

        if (!response.ok) {
          throw new Error(`Subtitle lookup failed with ${response.status}`);
        }

        const payload = (await response.json()) as { subtitles: Subtitle[] };

        if (!cancelled) {
          setSubtitles(payload.subtitles);
          setSelectedRoomSubtitleId((current) => current ?? payload.subtitles[0]?.id ?? null);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load subtitles');
        }
      }
    }

    void loadSubtitles();

    return () => {
      cancelled = true;
    };
  }, [status, media]);

  useEffect(() => {
    setSelectedRoomSubtitleId(room?.room.activeSubtitleId ?? null);
  }, [room]);

  useEffect(() => {
    if (!status || !room) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(`${status.apiBaseUrl}/api/rooms/${room.room.token}`)
        .then(async (response) => {
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { message?: string } | null;
            throw new Error(payload?.message ?? `Room lookup failed with ${response.status}`);
          }

          return (await response.json()) as RoomLookupResponse;
        })
        .then((payload) => {
          if (!cancelled) {
            if (deletingMediaIdRef.current && payload.room.activeMediaId === null) {
              setRoom(null);
              setSelectedRoomSubtitleId(null);
              return;
            }

            setRoom(payload);
            setSelectedRoomSubtitleId(payload.room.activeSubtitleId);
          }
        })
        .catch((reason) => {
          if (!cancelled) {
            if (deletingMediaIdRef.current && room.room.activeMediaId === deletingMediaIdRef.current) {
              return;
            }

            setError(reason instanceof Error ? reason.message : 'Failed to refresh room state');
          }
        });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, room?.room.token]);

  useEffect(() => {
    setDeleteConfirmArmed(false);
    setDeleteState('idle');

    if (media?.id) {
      deletingMediaIdRef.current = null;
    }
  }, [media?.id]);

  const playerUrl = media && status ? buildPlayerUrl(status.webUrl, media.id) : null;
  const lanPlayerUrl = media && status?.lanWebUrl
    ? buildPlayerUrl(status.lanWebUrl, media.id)
    : null;
  const roomPlayerUrl = room && status
    ? buildRoomPlayerUrl(status.webUrl, room.room.token)
    : null;
  const lanRoomPlayerUrl = room && status?.lanWebUrl
    ? buildRoomPlayerUrl(status.lanWebUrl, room.room.token)
    : null;
  async function selectExistingMedia(mediaId: string) {
    if (!status) {
      return;
    }

    setError(null);
    setMessage('Loading a previously uploaded media item from the server...');
    setRoom(null);
    setSubtitles([]);
    setSelectedRoomSubtitleId(null);
    setDeleteConfirmArmed(false);
    setDeleteState('idle');

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media/${mediaId}`);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Media lookup failed with ${response.status}`);
      }

      const payload = (await response.json()) as Media;
      setMedia(payload);
      setSelectedFile(null);
      setProcessingQueued(false);
      setUploadState(payload.status === 'error' ? 'error' : 'success');
      setMessage('Loaded an existing media item from the server. You can create a room or add more subtitles without re-uploading the video.');
    } catch (reason) {
      setUploadState('error');
      setError(reason instanceof Error ? reason.message : 'Failed to load existing media');
      setMessage(null);
    }
  }

  async function uploadSelectedFile() {
    if (!selectedFile || !status) {
      return;
    }

    setUploadState('uploading');
    setError(null);
    setMessage('Uploading media to the local server...');
    setRoom(null);
    setSubtitles([]);
    setSelectedRoomSubtitleId(null);

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(selectedFile.name)
        },
        body: selectedFile
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; detail?: string }
          | null;
        throw new Error(payload?.message ?? `Upload failed with ${response.status}`);
      }

      const payload = (await response.json()) as MediaOperationResponse;
      setMedia(payload.media);
      setProcessingQueued(payload.processingQueued);
      setUploadState(payload.media.status === 'error' ? 'error' : 'success');
      setMessage(
        payload.processingQueued
          ? 'Upload finished. Server-side processing has started.'
          : 'Upload finished. Processing was already running for this media.'
      );
    } catch (reason) {
      setUploadState('error');
      setError(reason instanceof Error ? reason.message : 'Upload failed');
      setMessage(null);
    }
  }

  async function uploadSelectedSubtitle() {
    if (!selectedSubtitleFile || !status || !media) {
      return;
    }

    setSubtitleUploadState('uploading');
    setError(null);
    setMessage('Uploading subtitle and converting it to WebVTT when needed...');

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media/${media.id}/subtitles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(selectedSubtitleFile.name)
        },
        body: selectedSubtitleFile
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(payload?.message ?? `Subtitle upload failed with ${response.status}`);
      }

      const payload = (await response.json()) as SubtitleOperationResponse;
      setSubtitles((current) => {
        const next = [...current.filter((subtitle) => subtitle.id !== payload.subtitle.id), payload.subtitle];
        next.sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.label.localeCompare(right.label));
        return next;
      });
      setSelectedRoomSubtitleId(payload.subtitle.id);
      setSubtitleUploadState('success');
      setMessage(`Subtitle ready: ${payload.subtitle.label} (${payload.subtitle.format} -> vtt)`);
    } catch (reason) {
      setSubtitleUploadState('error');
      setError(reason instanceof Error ? reason.message : 'Subtitle upload failed');
    }
  }

  async function createRoom() {
    if (!status || !media) {
      return;
    }

    setRoomState('uploading');
    setError(null);
    setMessage('Creating a shareable room for this media...');

    try {
      const defaultSubtitle = subtitles.find((subtitle) => subtitle.id === selectedRoomSubtitleId)
        ?? subtitles.find((subtitle) => subtitle.isDefault)
        ?? subtitles[0]
        ?? null;
      const response = await fetch(`${status.apiBaseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hostDisplayName: hostDisplayName.trim() || 'Host',
          expiresAt: roomExpiryHours === 'never'
            ? null
            : new Date(Date.now() + Number(roomExpiryHours) * 60 * 60 * 1000).toISOString(),
          activeMediaId: media.id,
          activeSubtitleId: defaultSubtitle?.id ?? null
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Room creation failed with ${response.status}`);
      }

      const payload = (await response.json()) as RoomLookupResponse;
      setRoom(payload);
      setRoomState('success');
      setSelectedRoomSubtitleId(payload.room.activeSubtitleId);
      setMessage('Room created. Share the secret room URL with the second viewer.');
    } catch (reason) {
      setRoomState('error');
      setError(reason instanceof Error ? reason.message : 'Room creation failed');
    }
  }

  async function updateRoomSubtitle() {
    if (!status || !room) {
      return;
    }

    setRoomSubtitleState('uploading');
    setError(null);
    setMessage('Updating the room subtitle selection...');

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/rooms/${room.room.token}/subtitle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activeSubtitleId: selectedRoomSubtitleId
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Subtitle update failed with ${response.status}`);
      }

      const payload = (await response.json()) as RoomLookupResponse;
      setRoom(payload);
      setRoomSubtitleState('success');
      setMessage('Room subtitle selection updated.');
    } catch (reason) {
      setRoomSubtitleState('error');
      setError(reason instanceof Error ? reason.message : 'Subtitle update failed');
    }
  }

  async function retryProcessing() {
    if (!status || !media) {
      return;
    }

    setUploadState('uploading');
    setError(null);
    setMessage('Requesting a new processing attempt...');

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media/${media.id}/process`, {
        method: 'POST'
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(payload?.message ?? `Retry failed with ${response.status}`);
      }

      const payload = (await response.json()) as MediaOperationResponse;
      setMedia(payload.media);
      setProcessingQueued(payload.processingQueued);
      setUploadState('success');
      setMessage(
        payload.processingQueued
          ? 'Processing restarted.'
          : 'A processing job is already running for this media.'
      );
    } catch (reason) {
      setUploadState('error');
      setError(reason instanceof Error ? reason.message : 'Retry failed');
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied to clipboard.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Copy failed');
    }
  }

  async function deleteSelectedMedia() {
    if (!status || !media) {
      return;
    }

    if (!deleteConfirmArmed) {
      setDeleteConfirmArmed(true);
      setMessage(`Click delete again to remove ${media.originalFileName}, its HLS output, and all attached subtitles.`);
      return;
    }

    deletingMediaIdRef.current = media.id;
    setDeleteState('uploading');
    setDeleteConfirmArmed(false);
    setError(null);
    setMessage('Deleting media, subtitles, and generated playback files...');

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media/${media.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Delete failed with ${response.status}`);
      }

      setRecentMedia((current) => ({
        kind: 'success',
        data: current.data.filter((item) => item.id !== media.id)
      }));
      setMedia(null);
      setRoom(null);
      setSubtitles([]);
      setSelectedFile(null);
      setSelectedSubtitleFile(null);
      setSelectedRoomSubtitleId(null);
      setProcessingQueued(false);
      setUploadState('idle');
      setSubtitleUploadState('idle');
      setRoomState('idle');
      setRoomSubtitleState('idle');
      setDeleteState('success');
      setMessage('Media deleted successfully.');

      void fetch(`${status.apiBaseUrl}/api/media`)
        .then(async (recentResponse) => {
          if (!recentResponse.ok) {
            return;
          }

          const recentPayload = (await recentResponse.json()) as MediaListResponse;
          setRecentMedia({ kind: 'success', data: recentPayload.media });
        })
        .catch(() => {
          // Ignore best-effort refresh failures after a confirmed delete.
        });
    } catch (reason) {
      deletingMediaIdRef.current = null;
      setDeleteState('error');
      setError(reason instanceof Error ? reason.message : 'Delete failed');
    }
  }
  return (
    <main className="shell">
      <section className="panel">
        <div className="hero">
          <div>
            <p className="eyebrow">Phase 4 Host Flow</p>
            <h1>Import media, create a secret room, and track who joined from the desktop app.</h1>
            <p className="copy">
              This dashboard now creates dedicated <span className="font-mono">/room/&lt;token&gt;</span> links, lets you set room expiration, and refreshes participant presence while the room is active.
            </p>
          </div>

          {status && (
            <dl className="statusGrid compact">
              <div>
                <dt>Tauri</dt>
                <dd>{status.tauri}</dd>
              </div>
              {showDebugUrls && (
                <>
                  <div>
                    <dt>API</dt>
                    <dd>{status.apiBaseUrl}</dd>
                  </div>
                  <div>
                    <dt>Web</dt>
                    <dd>{status.webUrl}</dd>
                  </div>
                  <div>
                    <dt>LAN API</dt>
                    <dd>{status.lanApiBaseUrl ?? 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>LAN Web</dt>
                    <dd>{status.lanWebUrl ?? 'Unavailable'}</dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </div>

        <section className="uploadPanel">
          <div>
            <p className="sectionEyebrow">Reuse media</p>
            <h2>Create a room from previous uploads</h2>
            <p className="sectionCopy">
              Pick a media item that is already stored on the server. This lets you create a new room in a later session without uploading the video again.
            </p>
          </div>

          {recentMedia.kind === 'loading' && (
            <div className="fileSummary">
              <p className="fileName">Loading recent media...</p>
              <p className="fileMeta">Fetching previously uploaded videos from the server.</p>
            </div>
          )}

          {recentMedia.kind === 'error' && (
            <div className="fileSummary">
              <p className="fileName">Could not load recent media</p>
              <p className="fileMeta">{recentMedia.message}</p>
            </div>
          )}

          {recentMedia.data.length > 0 && (
            <div className="mediaQueue">
              {recentMedia.data.map((item) => (
                <button
                  className={`mediaQueueItem${media?.id === item.id ? ' selected' : ''}`}
                  key={item.id}
                  onClick={() => {
                    void selectExistingMedia(item.id);
                  }}
                  type="button"
                >
                  <div className="mediaQueueHeader">
                    <p className="mediaQueueTitle">{item.originalFileName}</p>
                    <span className="mediaQueueBadge">{getStatusText(item.status)}</span>
                  </div>
                  <p className="mediaQueueMeta">Imported {formatImportedAt(item.createdAt)}</p>
                  <p className="mediaQueueMeta">Duration {formatDuration(item.durationMs)}</p>
                </button>
              ))}
            </div>
          )}

          {recentMedia.kind === 'success' && recentMedia.data.length === 0 && (
            <div className="fileSummary">
              <p className="fileName">No previous uploads yet</p>
              <p className="fileMeta">Upload your first movie below and it will appear here for future sessions.</p>
            </div>
          )}
        </section>

        <section className="uploadPanel">
          <div>
            <p className="sectionEyebrow">Select media</p>
            <h2>Choose a movie file from this machine</h2>
            <p className="sectionCopy">
              Accepted by the browser picker first, then validated again on the server during ffprobe.
            </p>
          </div>

          <div className="actionsRow">
            <input
              accept="video/*,.mkv,.mp4,.mov,.avi,.webm"
              className="hiddenInput"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setSelectedFile(nextFile);
                setError(null);
                setMessage(nextFile ? 'File selected and ready to upload.' : null);
              }}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="primaryButton"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Pick local movie
            </button>
            <button
              className="secondaryButton"
              disabled={!selectedFile || !status || uploadState === 'uploading'}
              onClick={() => {
                void uploadSelectedFile();
              }}
              type="button"
            >
              {uploadState === 'uploading' ? 'Uploading...' : 'Upload and process'}
            </button>
          </div>

          <div className="fileSummary">
            <p className="fileName">{selectedFile?.name ?? 'No file selected yet'}</p>
            <p className="fileMeta">
              {selectedFile
                ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`
                : 'Choose a local movie only when you want to add a new upload to the server.'}
            </p>
          </div>
        </section>

        {media && (
          <section className="uploadPanel">
            <div>
              <p className="sectionEyebrow">Select subtitles</p>
              <h2>Attach subtitle files to the current media</h2>
              <p className="sectionCopy">
                Upload <span className="font-mono">.srt</span>, <span className="font-mono">.vtt</span>, or <span className="font-mono">.ass</span>. This also works for media selected from a previous session, so you can keep adding subtitles later.
              </p>
            </div>

            <div className="actionsRow">
              <input
                accept=".srt,.vtt,.ass"
                className="hiddenInput"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setSelectedSubtitleFile(nextFile);
                  setError(null);
                  setMessage(nextFile ? 'Subtitle selected and ready to upload.' : null);
                }}
                ref={subtitleInputRef}
                type="file"
              />
              <button
                className="primaryButton"
                onClick={() => subtitleInputRef.current?.click()}
                type="button"
              >
                Pick subtitle file
              </button>
              <button
                className="secondaryButton"
                disabled={!selectedSubtitleFile || !status || subtitleUploadState === 'uploading'}
                onClick={() => {
                  void uploadSelectedSubtitle();
                }}
                type="button"
              >
                {subtitleUploadState === 'uploading' ? 'Uploading...' : 'Upload subtitle'}
              </button>
            </div>

            <div className="fileSummary">
              <p className="fileName">{selectedSubtitleFile?.name ?? 'No subtitle selected yet'}</p>
              <p className="fileMeta">
                {subtitles.length > 0
                  ? `${subtitles.length} subtitle track${subtitles.length === 1 ? '' : 's'} attached to this media.`
                  : 'Add at least one subtitle to exercise the Phase 3 player flow.'}
              </p>
            </div>
          </section>
        )}

        {room && (
          <section className="uploadPanel">
            <div>
              <p className="sectionEyebrow">Room state</p>
              <h2>Manage the active secret room</h2>
              <p className="sectionCopy">
                Update the shared subtitle, review the expiration, and watch the participant list refresh while this room is open.
              </p>
            </div>

            <div className="actionsRow roomSubtitleRow">
              <select
                className="selectInput"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedRoomSubtitleId(nextValue === '__off__' ? null : nextValue);
                }}
                value={selectedRoomSubtitleId ?? '__off__'}
              >
                <option value="__off__">No subtitle</option>
                {subtitles.map((subtitle) => (
                  <option key={subtitle.id} value={subtitle.id}>
                    {subtitle.label} ({subtitle.format})
                  </option>
                ))}
              </select>
              <button
                className="secondaryButton"
                disabled={roomSubtitleState === 'uploading'}
                onClick={() => {
                  void updateRoomSubtitle();
                }}
                type="button"
              >
                {roomSubtitleState === 'uploading' ? 'Updating...' : 'Update room subtitle'}
              </button>
            </div>

            <div className="fileSummary">
              <p className="fileName">
                Current room subtitle: {room.subtitles.find((subtitle) => subtitle.id === room.room.activeSubtitleId)?.label ?? 'None'}
              </p>
              <p className="fileMeta">Room token: {room.room.token}</p>
              <p className="fileMeta">Expires: {room.room.expiresAt ? formatImportedAt(room.room.expiresAt) : 'No expiration set'}</p>
              <p className="fileMeta">Participants: {room.participants.map((participant) => `${participant.displayName} (${participant.role}, ${participant.connectionState})`).join(' • ') || 'Waiting for viewers'}</p>
            </div>
          </section>
        )}

        {message && <p className="notice success">{message}</p>}
        {error && <p className="notice error">{error}</p>}

        {media && (
          <section className="resultGrid">
            <article className="card">
              <p className="sectionEyebrow">Processing state</p>
              <h2>{media.originalFileName}</h2>
              <p className="cardCopy">{getStatusText(media.status)}</p>
              <dl className="detailsGrid">
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDuration(media.durationMs)}</dd>
                </div>
                <div>
                  <dt>Video</dt>
                  <dd>
                    {media.videoCodec ?? 'Unknown'}
                    {media.width && media.height ? ` • ${media.width}x${media.height}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Audio</dt>
                  <dd>{media.audioCodec ?? 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Queued</dt>
                  <dd>{processingQueued ? 'Yes' : 'Already running / finished'}</dd>
                </div>
              </dl>

              {media.processingError && (
                <p className="inlineError">{media.processingError}</p>
              )}

              <div className="fileSummary">
                <p className="fileName">Room host settings</p>
                <div className="actionsRow roomSubtitleRow">
                  <input
                    className="selectInput"
                    maxLength={48}
                    onChange={(event) => setHostDisplayName(event.target.value)}
                    placeholder="Host display name"
                    value={hostDisplayName}
                  />
                  <select
                    className="selectInput"
                    onChange={(event) => setRoomExpiryHours(event.target.value)}
                    value={roomExpiryHours}
                  >
                    <option value="6">Expires in 6 hours</option>
                    <option value="24">Expires in 24 hours</option>
                    <option value="72">Expires in 72 hours</option>
                    <option value="never">No expiration</option>
                  </select>
                </div>
              </div>

              <div className="actionsRow leftAligned">
                <button
                  className="secondaryButton"
                  disabled={uploadState === 'uploading' || deleteState === 'uploading'}
                  onClick={() => {
                    void retryProcessing();
                  }}
                  type="button"
                >
                  Retry processing
                </button>
                <button
                  className="secondaryButton"
                  disabled={deleteState === 'uploading' || uploadState === 'uploading'}
                  onClick={() => {
                    void deleteSelectedMedia();
                  }}
                  type="button"
                >
                  {deleteState === 'uploading'
                    ? 'Deleting...'
                    : deleteConfirmArmed
                      ? 'Confirm delete'
                      : 'Delete media'}
                </button>
                <button
                  className="secondaryButton"
                  disabled={media.status !== 'ready' || roomState === 'uploading'}
                  onClick={() => {
                    void createRoom();
                  }}
                  type="button"
                >
                  {roomState === 'uploading' ? 'Creating room...' : 'Create room'}
                </button>
              </div>
            </article>

            <article className="card accentCard">
              <p className="sectionEyebrow">Share and preview</p>
              <h2>Generated URLs</h2>
              <p className="cardCopy">
                Local room URLs are for this machine. LAN room URLs are for other devices on the same network.
              </p>

              <div className="linkGroup">
                <span className="linkLabel">Configured secret room URL</span>
                <p className="linkValue">{room?.shareUrl ?? 'Create a room after processing completes'}</p>
                {room?.shareUrl && (
                  <button className="ghostButton" onClick={() => void copyText(room.shareUrl)} type="button">
                    Copy configured room URL
                  </button>
                )}
              </div>

              <div className="linkGroup">
                <span className="linkLabel">Local secret room URL</span>
                <p className="linkValue">{roomPlayerUrl ?? 'Create a room to get the dedicated /room/<token> link'}</p>
                {roomPlayerUrl && (
                  <button className="ghostButton" onClick={() => void copyText(roomPlayerUrl)} type="button">
                    Copy local room player URL
                  </button>
                )}
              </div>

              <div className="linkGroup">
                <span className="linkLabel">LAN secret room URL</span>
                <p className="linkValue">{lanRoomPlayerUrl ?? 'Create a room and make sure LAN detection succeeds'}</p>
                {lanRoomPlayerUrl && (
                  <button className="ghostButton" onClick={() => void copyText(lanRoomPlayerUrl)} type="button">
                    Copy LAN secret room URL
                  </button>
                )}
              </div>

              {showDebugUrls && (
                <>
                  <div className="linkGroup">
                    <span className="linkLabel">Local player URL</span>
                    <p className="linkValue">{playerUrl ?? 'Unavailable until media exists'}</p>
                    {playerUrl && (
                      <button className="ghostButton" onClick={() => void copyText(playerUrl)} type="button">
                        Copy local player URL
                      </button>
                    )}
                  </div>

                  <div className="linkGroup">
                    <span className="linkLabel">LAN player URL</span>
                    <p className="linkValue">{lanPlayerUrl ?? 'Available after LAN detection succeeds'}</p>
                    {lanPlayerUrl && (
                      <button className="ghostButton" onClick={() => void copyText(lanPlayerUrl)} type="button">
                        Copy LAN player URL
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>
          </section>
        )}

        {subtitles.length > 0 && (
          <section className="resultGrid">
            <article className="card">
              <p className="sectionEyebrow">Subtitle tracks</p>
              <h2>Available tracks</h2>
              <p className="cardCopy">
                These tracks are now registered on the server and can be loaded by the browser player.
              </p>
              <div className="linkGroup">
                {subtitles.map((subtitle) => (
                  <p className="linkValue" key={subtitle.id}>
                    {subtitle.label} • {subtitle.format}{subtitle.isDefault ? ' • default' : ''}
                  </p>
                ))}
              </div>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}


