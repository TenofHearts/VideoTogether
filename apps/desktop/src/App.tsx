import { useEffect, useRef, useState } from 'react';

import type {
  DesktopStatus,
  Media,
  MediaOperationResponse
} from '@videoshare/shared-types';

type UploadState = 'idle' | 'uploading' | 'error' | 'success';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const fallbackStatus: DesktopStatus = {
  apiBaseUrl: 'http://localhost:3000',
  webUrl: 'http://localhost:5173',
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

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [processingQueued, setProcessingQueued] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDesktopStatus() {
      const maybeTauriWindow = window as TauriWindow;

      if (!maybeTauriWindow.__TAURI_INTERNALS__) {
        if (!cancelled) {
          setStatus(fallbackStatus);
        }
        return;
      }

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

  const playerUrl = media && status ? `${status.webUrl}/?mediaId=${media.id}` : null;
  const manifestUrl =
    media && status && media.hlsManifestPath
      ? `${status.apiBaseUrl}/media/${media.id}/${media.hlsManifestPath}`
      : null;

  async function uploadSelectedFile() {
    if (!selectedFile || !status) {
      return;
    }

    setUploadState('uploading');
    setError(null);
    setMessage('Uploading media to the local server...');

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

  return (
    <main className="shell">
      <section className="panel">
        <div className="hero">
          <div>
            <p className="eyebrow">Phase 2 Host Flow</p>
            <h1>Import a local movie and kick off HLS processing from the desktop app.</h1>
            <p className="copy">
              This host dashboard now uploads a selected file to the Fastify server,
              starts ffprobe and FFmpeg processing, and gives you the preview URLs needed
              for browser playback testing.
            </p>
          </div>

          {status && (
            <dl className="statusGrid compact">
              <div>
                <dt>API</dt>
                <dd>{status.apiBaseUrl}</dd>
              </div>
              <div>
                <dt>Web</dt>
                <dd>{status.webUrl}</dd>
              </div>
              <div>
                <dt>Tauri</dt>
                <dd>{status.tauri}</dd>
              </div>
            </dl>
          )}
        </div>

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
                : 'Choose a local movie to begin the Phase 2 workflow.'}
            </p>
          </div>
        </section>

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

              <div className="actionsRow leftAligned">
                <button
                  className="secondaryButton"
                  disabled={uploadState === 'uploading'}
                  onClick={() => {
                    void retryProcessing();
                  }}
                  type="button"
                >
                  Retry processing
                </button>
              </div>
            </article>

            <article className="card accentCard">
              <p className="sectionEyebrow">Share and preview</p>
              <h2>Generated URLs</h2>
              <p className="cardCopy">
                Open the player URL in a browser to test the HLS playback surface.
              </p>

              <div className="linkGroup">
                <span className="linkLabel">Player URL</span>
                <p className="linkValue">{playerUrl ?? 'Unavailable until media exists'}</p>
                {playerUrl && (
                  <button className="ghostButton" onClick={() => void copyText(playerUrl)} type="button">
                    Copy player URL
                  </button>
                )}
              </div>

              <div className="linkGroup">
                <span className="linkLabel">Manifest URL</span>
                <p className="linkValue">{manifestUrl ?? 'Will appear after HLS is ready'}</p>
                {manifestUrl && (
                  <button className="ghostButton" onClick={() => void copyText(manifestUrl)} type="button">
                    Copy manifest URL
                  </button>
                )}
              </div>
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
