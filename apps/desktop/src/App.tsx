import { useEffect, useRef, useState } from 'react';

import type {
  DesktopStatus,
  Media,
  MediaListResponse,
  MediaOperationResponse,
  MediaSubtitlesResponse,
  Participant,
  RoomLookupResponse,
  ServiceHealth,
  Subtitle,
  SubtitleOperationResponse,
  SystemStatus
} from '@videoshare/shared-types';

type ActionState = 'idle' | 'working' | 'error' | 'success';

type RecentMediaState =
  | { kind: 'loading'; data: Media[] }
  | { kind: 'error'; data: Media[]; message: string }
  | { kind: 'success'; data: Media[] };

type StepState = 'complete' | 'active' | 'pending' | 'error';

type DiagnosticsState<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: T };

type ProcessingStep = {
  label: string;
  description: string;
  state: StepState;
};

const showDebugUrls = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_DEBUG_URLS ?? '').toLowerCase()
);

const fallbackStatus: DesktopStatus = {
  apiBaseUrl: 'http://localhost:3000',
  webUrl: 'http://localhost:3000',
  publicWebUrl: null,
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
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, '0')
    )
    .join(':');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatFileSize(size: number): string {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusText(status: Media['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued for the HLS pipeline';
    case 'processing':
      return 'Running ffprobe and FFmpeg';
    case 'ready':
      return 'Ready for room playback';
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
  const normalizedPath = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;
  url.pathname = `${normalizedPath}room/${token}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
function buildParticipantRoomUrl(
  baseUrl: string,
  token: string,
  participantId: string,
  displayName?: string | null
): string {
  const url = new URL(buildRoomPlayerUrl(baseUrl, token));
  url.searchParams.set('participantId', participantId);

  if (displayName?.trim()) {
    url.searchParams.set('displayName', displayName.trim());
  }

  return url.toString();
}

function getProcessingSteps(media: Media | null): ProcessingStep[] {
  if (!media) {
    return [
      {
        label: 'Choose media',
        description: 'Pick a movie from disk or the server library.',
        state: 'active'
      },
      {
        label: 'Process to HLS',
        description: 'The server probes the file and generates HLS output.',
        state: 'pending'
      },
      {
        label: 'Open a room',
        description: 'Create a secret room after the media is ready.',
        state: 'pending'
      }
    ];
  }

  switch (media.status) {
    case 'pending':
      return [
        {
          label: 'Media uploaded',
          description: 'The source file is stored on the host machine.',
          state: 'complete'
        },
        {
          label: 'Processing queued',
          description: 'Waiting for ffprobe and FFmpeg to start.',
          state: 'active'
        },
        {
          label: 'Ready for rooms',
          description:
            'Share URLs become useful after HLS generation finishes.',
          state: 'pending'
        }
      ];
    case 'processing':
      return [
        {
          label: 'Media uploaded',
          description: 'The source file is stored on the host machine.',
          state: 'complete'
        },
        {
          label: 'HLS pipeline running',
          description:
            'The server is probing metadata and writing playlists and segments.',
          state: 'active'
        },
        {
          label: 'Ready for rooms',
          description:
            'Room creation stays enabled after processing completes.',
          state: 'pending'
        }
      ];
    case 'ready':
      return [
        {
          label: 'Media uploaded',
          description: 'The source file is available in local storage.',
          state: 'complete'
        },
        {
          label: 'HLS generated',
          description: 'Manifest and segments are ready for browser playback.',
          state: 'complete'
        },
        {
          label: 'Ready for rooms',
          description:
            'You can create, share, and manage a room from this dashboard.',
          state: 'complete'
        }
      ];
    case 'error':
      return [
        {
          label: 'Media uploaded',
          description: 'The original file is still stored locally.',
          state: 'complete'
        },
        {
          label: 'Processing failed',
          description:
            media.processingError ?? 'The HLS pipeline stopped with an error.',
          state: 'error'
        },
        {
          label: 'Ready for rooms',
          description: 'Retry processing before creating a room.',
          state: 'pending'
        }
      ];
    default:
      return [];
  }
}

function getParticipantRoleLabel(participant: Participant): string {
  return participant.role === 'host' ? 'Host' : 'Guest';
}

function getParticipantConnectionLabel(participant: Participant): string {
  return participant.connectionState === 'connected'
    ? 'Connected'
    : 'Disconnected';
}

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
    detail?: string;
  } | null;

  return (
    payload?.message ?? payload?.detail ?? `${fallback} (${response.status})`
  );
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [health, setHealth] = useState<DiagnosticsState<ServiceHealth>>({
    kind: 'loading'
  });
  const [systemStatus, setSystemStatus] = useState<
    DiagnosticsState<SystemStatus>
  >({ kind: 'loading' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSubtitleFile, setSelectedSubtitleFile] = useState<File | null>(
    null
  );
  const [selectedRoomSubtitleId, setSelectedRoomSubtitleId] = useState<
    string | null
  >(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [room, setRoom] = useState<RoomLookupResponse | null>(null);
  const [recentMedia, setRecentMedia] = useState<RecentMediaState>({
    kind: 'loading',
    data: []
  });
  const [uploadState, setUploadState] = useState<ActionState>('idle');
  const [subtitleUploadState, setSubtitleUploadState] =
    useState<ActionState>('idle');
  const [roomState, setRoomState] = useState<ActionState>('idle');
  const [roomSubtitleState, setRoomSubtitleState] =
    useState<ActionState>('idle');
  const [closeRoomState, setCloseRoomState] = useState<ActionState>('idle');
  const [deleteState, setDeleteState] = useState<ActionState>('idle');
  const [deleteConfirmArmed, setDeleteConfirmArmed] = useState(false);
  const [processingQueued, setProcessingQueued] = useState(false);
  const [hostDisplayName, setHostDisplayName] = useState('Host');
  const [roomExpiryHours, setRoomExpiryHours] = useState('24');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActiveRoom = room?.room.status === 'active';
  const roomPlayerUrl =
    room && status ? buildRoomPlayerUrl(status.webUrl, room.room.token) : null;
  const publicRoomPlayerUrl =
    room && status?.publicWebUrl
      ? buildRoomPlayerUrl(status.publicWebUrl, room.room.token)
      : null;
  const lanRoomPlayerUrl =
    room && status?.lanWebUrl
      ? buildRoomPlayerUrl(status.lanWebUrl, room.room.token)
      : null;
  const secondaryRoomPlayerUrl = publicRoomPlayerUrl ?? lanRoomPlayerUrl;
  const secondaryRoomLabel = publicRoomPlayerUrl
    ? 'NGROK room URL'
    : 'LAN room URL';
  const secondaryRoomCopyLabel = publicRoomPlayerUrl
    ? 'Copy ngrok URL'
    : 'Copy LAN URL';
  const hostParticipant =
    room?.participants.find(
      (participant) => participant.id === room.room.hostClientId
    ) ?? null;
  const hostRoomPlayerUrl =
    room && status && hostParticipant
      ? buildParticipantRoomUrl(
          status.webUrl,
          room.room.token,
          hostParticipant.id,
          hostParticipant.displayName
        )
      : null;
  const publicHostRoomPlayerUrl =
    room && status?.publicWebUrl && hostParticipant
      ? buildParticipantRoomUrl(
          status.publicWebUrl,
          room.room.token,
          hostParticipant.id,
          hostParticipant.displayName
        )
      : null;
  const lanHostRoomPlayerUrl =
    room && status?.lanWebUrl && hostParticipant
      ? buildParticipantRoomUrl(
          status.lanWebUrl,
          room.room.token,
          hostParticipant.id,
          hostParticipant.displayName
        )
      : null;
  const secondaryHostRoomPlayerUrl =
    publicHostRoomPlayerUrl ?? lanHostRoomPlayerUrl;
  const secondaryHostRoomLabel = publicHostRoomPlayerUrl
    ? 'NGROK host room URL'
    : 'LAN host room URL';
  const secondaryHostRoomCopyLabel = publicHostRoomPlayerUrl
    ? 'Copy ngrok host URL'
    : 'Copy LAN host URL';
  const playerUrl =
    media && status ? buildPlayerUrl(status.webUrl, media.id) : null;
  const publicPlayerUrl =
    media && status?.publicWebUrl
      ? buildPlayerUrl(status.publicWebUrl, media.id)
      : null;
  const lanPlayerUrl =
    media && status?.lanWebUrl
      ? buildPlayerUrl(status.lanWebUrl, media.id)
      : null;
  const secondaryPlayerUrl = publicPlayerUrl ?? lanPlayerUrl;
  const secondaryPlayerLabel = publicPlayerUrl
    ? 'NGROK player preview'
    : 'LAN player preview';
  const secondaryPlayerCopyLabel = publicPlayerUrl
    ? 'Copy ngrok player URL'
    : 'Copy LAN player URL';
  const selectedSubtitle =
    subtitles.find((subtitle) => subtitle.id === selectedRoomSubtitleId) ??
    null;
  const activeRoomSubtitle =
    room?.subtitles.find(
      (subtitle) => subtitle.id === room.room.activeSubtitleId
    ) ?? null;
  const participants = room?.participants ?? [];
  const guestCount = participants.filter(
    (participant) => participant.role === 'guest'
  ).length;

  async function refreshRecentMedia() {
    if (!status) {
      return;
    }

    try {
      const response = await fetch(`${status.apiBaseUrl}/api/media`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Media list failed'));
      }

      const payload = (await response.json()) as MediaListResponse;
      setRecentMedia({ kind: 'success', data: payload.media });
    } catch (reason) {
      setRecentMedia((current) => ({
        kind: 'error',
        data: current.data,
        message:
          reason instanceof Error
            ? reason.message
            : 'Failed to load recent media'
      }));
    }
  }

  async function refreshDiagnostics() {
    if (!status) {
      return;
    }

    try {
      const [healthResponse, systemResponse] = await Promise.all([
        fetch(`${status.apiBaseUrl}/health`),
        fetch(`${status.apiBaseUrl}/api/system/status`)
      ]);

      if (!healthResponse.ok) {
        throw new Error(
          await readErrorMessage(healthResponse, 'Health check failed')
        );
      }

      if (!systemResponse.ok) {
        throw new Error(
          await readErrorMessage(systemResponse, 'System status failed')
        );
      }

      setHealth({
        kind: 'success',
        data: (await healthResponse.json()) as ServiceHealth
      });
      setSystemStatus({
        kind: 'success',
        data: (await systemResponse.json()) as SystemStatus
      });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'Diagnostics request failed';
      setHealth({ kind: 'error', message });
      setSystemStatus({ kind: 'error', message });
    }
  }

  async function fetchMediaById(mediaId: string): Promise<Media> {
    if (!status) {
      throw new Error('Desktop status is not ready');
    }

    const response = await fetch(`${status.apiBaseUrl}/api/media/${mediaId}`);

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, 'Media lookup failed'));
    }

    return (await response.json()) as Media;
  }

  async function fetchSubtitles(mediaId: string): Promise<Subtitle[]> {
    if (!status) {
      throw new Error('Desktop status is not ready');
    }

    const response = await fetch(
      `${status.apiBaseUrl}/api/media/${mediaId}/subtitles`
    );

    if (!response.ok) {
      throw new Error(
        await readErrorMessage(response, 'Subtitle lookup failed')
      );
    }

    const payload = (await response.json()) as MediaSubtitlesResponse;
    return payload.subtitles;
  }

  async function fetchRoom(token: string): Promise<RoomLookupResponse | null> {
    if (!status) {
      throw new Error('Desktop status is not ready');
    }

    const response = await fetch(`${status.apiBaseUrl}/api/rooms/${token}`);

    if (!response.ok) {
      const nextError = await readErrorMessage(response, 'Room lookup failed');

      if (response.status === 404 || response.status === 410) {
        setRoom(null);
        setCloseRoomState('idle');
        setRoomSubtitleState('idle');
        setMessage(nextError);
        return null;
      }

      throw new Error(nextError);
    }

    return (await response.json()) as RoomLookupResponse;
  }

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

    async function loadRecentMediaWithGuard() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/media`);

        if (!response.ok) {
          throw new Error(
            await readErrorMessage(response, 'Media list failed')
          );
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
            message:
              reason instanceof Error
                ? reason.message
                : 'Failed to load recent media'
          }));
        }
      }
    }

    void loadRecentMediaWithGuard();
    const timer = window.setInterval(() => {
      void loadRecentMediaWithGuard();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    if (!status) {
      return;
    }

    let cancelled = false;
    const apiBaseUrl = status.apiBaseUrl;

    async function loadDiagnostics() {
      try {
        const [healthResponse, systemResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/health`),
          fetch(`${apiBaseUrl}/api/system/status`)
        ]);

        if (!healthResponse.ok) {
          throw new Error(
            await readErrorMessage(healthResponse, 'Health check failed')
          );
        }

        if (!systemResponse.ok) {
          throw new Error(
            await readErrorMessage(systemResponse, 'System status failed')
          );
        }

        const nextHealth = (await healthResponse.json()) as ServiceHealth;
        const nextSystemStatus = (await systemResponse.json()) as SystemStatus;

        if (!cancelled) {
          setHealth({ kind: 'success', data: nextHealth });
          setSystemStatus({ kind: 'success', data: nextSystemStatus });
        }
      } catch (reason) {
        if (!cancelled) {
          const message =
            reason instanceof Error
              ? reason.message
              : 'Diagnostics request failed';
          setHealth({ kind: 'error', message });
          setSystemStatus({ kind: 'error', message });
        }
      }
    }

    void loadDiagnostics();
    const timer = window.setInterval(() => {
      void loadDiagnostics();
    }, 20000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    if (
      !status ||
      !media ||
      (media.status !== 'pending' && media.status !== 'processing')
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchMediaById(media.id)
        .then((nextMedia) => {
          if (cancelled) {
            return;
          }

          setMedia(nextMedia);

          if (nextMedia.status === 'ready') {
            setUploadState('success');
            setMessage(
              'HLS output is ready. The movie can now be used for a room.'
            );
            void refreshRecentMedia();
          }

          if (nextMedia.status === 'error') {
            setUploadState('error');
            setError(nextMedia.processingError ?? 'Media processing failed');
            void refreshRecentMedia();
          }
        })
        .catch((reason) => {
          if (!cancelled) {
            setUploadState('error');
            setError(
              reason instanceof Error
                ? reason.message
                : 'Failed to refresh media status'
            );
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

    void fetchSubtitles(media.id)
      .then((nextSubtitles) => {
        if (cancelled) {
          return;
        }

        setSubtitles(nextSubtitles);
        setSelectedRoomSubtitleId(
          (current) => current ?? nextSubtitles[0]?.id ?? null
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Failed to load subtitles'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, media?.id]);

  useEffect(() => {
    if (!room) {
      return;
    }

    setSelectedRoomSubtitleId(room.room.activeSubtitleId);
  }, [room]);

  useEffect(() => {
    if (!status || !room) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetchRoom(room.room.token)
        .then((payload) => {
          if (!payload || cancelled) {
            return;
          }

          setRoom(payload);
          setSelectedRoomSubtitleId(payload.room.activeSubtitleId);
        })
        .catch((reason) => {
          if (!cancelled) {
            setError(
              reason instanceof Error
                ? reason.message
                : 'Failed to refresh room state'
            );
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
  }, [media?.id]);

  async function selectExistingMedia(mediaId: string) {
    if (!status) {
      return;
    }

    if (hasActiveRoom && room?.room.activeMediaId !== mediaId) {
      setError('Close the active room before switching to a different movie.');
      setMessage(null);
      return;
    }

    setError(null);
    setMessage('Loading the selected media from the server library...');

    try {
      const payload = await fetchMediaById(mediaId);
      setMedia(payload);
      setSelectedFile(null);
      setProcessingQueued(false);
      setUploadState(payload.status === 'error' ? 'error' : 'success');
      setRoom((currentRoom) =>
        currentRoom?.room.activeMediaId === payload.id ? currentRoom : null
      );
      setMessage(
        'Media loaded. You can manage subtitles or open a room from this dashboard.'
      );
    } catch (reason) {
      setUploadState('error');
      setError(
        reason instanceof Error
          ? reason.message
          : 'Failed to load existing media'
      );
      setMessage(null);
    }
  }

  async function uploadSelectedFile() {
    if (!selectedFile || !status) {
      return;
    }

    if (hasActiveRoom) {
      setError('Close the active room before uploading a new movie.');
      setMessage(null);
      return;
    }

    setUploadState('working');
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
        throw new Error(await readErrorMessage(response, 'Upload failed'));
      }

      const payload = (await response.json()) as MediaOperationResponse;
      setMedia(payload.media);
      setProcessingQueued(payload.processingQueued);
      setUploadState(payload.media.status === 'error' ? 'error' : 'success');
      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setMessage(
        payload.processingQueued
          ? 'Upload finished. Server-side processing has started.'
          : 'Upload finished. A processing job was already running for this media.'
      );
      await refreshRecentMedia();
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

    setSubtitleUploadState('working');
    setError(null);
    setMessage('Uploading subtitle and converting it to WebVTT when needed...');

    try {
      const response = await fetch(
        `${status.apiBaseUrl}/api/media/${media.id}/subtitles`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(selectedSubtitleFile.name)
          },
          body: selectedSubtitleFile
        }
      );

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Subtitle upload failed')
        );
      }

      const payload = (await response.json()) as SubtitleOperationResponse;
      setSubtitles((current) => {
        const next = [
          ...current.filter((subtitle) => subtitle.id !== payload.subtitle.id),
          payload.subtitle
        ];
        next.sort(
          (left, right) =>
            Number(right.isDefault) - Number(left.isDefault) ||
            left.label.localeCompare(right.label)
        );
        return next;
      });
      setSelectedRoomSubtitleId(payload.subtitle.id);
      setSelectedSubtitleFile(null);
      setSubtitleUploadState('success');

      if (subtitleInputRef.current) {
        subtitleInputRef.current.value = '';
      }

      setMessage(`Subtitle ready: ${payload.subtitle.label}.`);
    } catch (reason) {
      setSubtitleUploadState('error');
      setError(
        reason instanceof Error ? reason.message : 'Subtitle upload failed'
      );
    }
  }

  async function createRoom() {
    if (!status || !media) {
      return;
    }

    if (hasActiveRoom) {
      setError('Close the current room before creating a new one.');
      setMessage(null);
      return;
    }

    setRoomState('working');
    setCloseRoomState('idle');
    setError(null);
    setMessage('Creating a shareable room for the selected movie...');

    try {
      const defaultSubtitle =
        subtitles.find((subtitle) => subtitle.id === selectedRoomSubtitleId) ??
        subtitles.find((subtitle) => subtitle.isDefault) ??
        subtitles[0] ??
        null;
      const response = await fetch(`${status.apiBaseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hostDisplayName: hostDisplayName.trim() || 'Host',
          expiresAt:
            roomExpiryHours === 'never'
              ? null
              : new Date(
                  Date.now() + Number(roomExpiryHours) * 60 * 60 * 1000
                ).toISOString(),
          activeMediaId: media.id,
          activeSubtitleId: defaultSubtitle?.id ?? null
        })
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Room creation failed')
        );
      }

      const payload = (await response.json()) as RoomLookupResponse;
      setRoom(payload);
      setRoomState('success');
      setSelectedRoomSubtitleId(payload.room.activeSubtitleId);
      setMessage(
        'Room created. Copy the guest or host room URL from the share panel.'
      );
    } catch (reason) {
      setRoomState('error');
      setError(
        reason instanceof Error ? reason.message : 'Room creation failed'
      );
    }
  }

  async function updateRoomSubtitle() {
    if (!status || !room) {
      return;
    }

    setRoomSubtitleState('working');
    setError(null);
    setMessage('Updating the room subtitle selection...');

    try {
      const response = await fetch(
        `${status.apiBaseUrl}/api/rooms/${room.room.token}/subtitle`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            activeSubtitleId: selectedRoomSubtitleId
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(response, 'Subtitle update failed')
        );
      }

      const payload = (await response.json()) as RoomLookupResponse;
      setRoom(payload);
      setRoomSubtitleState('success');
      setMessage('Room subtitle selection updated.');
    } catch (reason) {
      setRoomSubtitleState('error');
      setError(
        reason instanceof Error ? reason.message : 'Subtitle update failed'
      );
    }
  }

  async function closeRoom() {
    if (!status || !room) {
      return;
    }

    setCloseRoomState('working');
    setError(null);
    setMessage('Closing the active room...');

    try {
      const response = await fetch(
        `${status.apiBaseUrl}/api/rooms/${room.room.token}/close`,
        {
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Room close failed'));
      }

      setRoom(null);
      setCloseRoomState('success');
      setRoomSubtitleState('idle');
      setMessage('Room closed. You can now switch media or open a new room.');
    } catch (reason) {
      setCloseRoomState('error');
      setError(reason instanceof Error ? reason.message : 'Room close failed');
    }
  }

  async function retryProcessing() {
    if (!status || !media) {
      return;
    }

    if (hasActiveRoom) {
      setError('Close the active room before retrying media processing.');
      setMessage(null);
      return;
    }

    setUploadState('working');
    setError(null);
    setMessage('Requesting a new processing attempt...');

    try {
      const response = await fetch(
        `${status.apiBaseUrl}/api/media/${media.id}/process`,
        {
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Retry failed'));
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
      await refreshRecentMedia();
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

    if (hasActiveRoom && room?.room.activeMediaId === media.id) {
      setError('Close the active room before deleting its movie.');
      setMessage(null);
      return;
    }

    if (!deleteConfirmArmed) {
      setDeleteConfirmArmed(true);
      setMessage(
        `Click delete again to remove ${media.originalFileName} and all generated playback files.`
      );
      return;
    }

    setDeleteState('working');
    setDeleteConfirmArmed(false);
    setError(null);
    setMessage('Deleting media, subtitles, and generated playback files...');

    try {
      const response = await fetch(
        `${status.apiBaseUrl}/api/media/${media.id}`,
        {
          method: 'DELETE'
        }
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Delete failed'));
      }

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
      setCloseRoomState('idle');
      setDeleteState('success');
      setMessage('Media deleted successfully.');
      await refreshRecentMedia();
    } catch (reason) {
      setDeleteState('error');
      setError(reason instanceof Error ? reason.message : 'Delete failed');
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <header className="hero">
          <div className="heroCopy">
            <p className="eyebrow">VideoTogether host dashboard</p>
            <h1>Run the full host workflow from one desktop control panel.</h1>
            <p className="copy">
              Import or reuse a movie, process it to HLS, manage subtitles,
              create private room links, and monitor viewer presence without
              leaving the desktop app.
            </p>
            <div className="heroActions">
              {room?.shareUrl && (
                <button
                  className="primaryButton"
                  onClick={() => void copyText(room.shareUrl)}
                  type="button"
                >
                  Copy secret room URL
                </button>
              )}
              {room && (
                <button
                  className="secondaryButton"
                  disabled={closeRoomState === 'working'}
                  onClick={() => {
                    void closeRoom();
                  }}
                  type="button"
                >
                  {closeRoomState === 'working'
                    ? 'Closing room...'
                    : 'Close current room'}
                </button>
              )}
            </div>
          </div>

          {status && (
            <div className="heroStatusGrid">
              <div className="statusCard">
                <span className="statusLabel">Tauri</span>
                <strong>{status.tauri}</strong>
              </div>
              <div className="statusCard">
                <span className="statusLabel">Selected movie</span>
                <strong>
                  {media?.originalFileName ?? 'No media selected'}
                </strong>
              </div>
              <div className="statusCard">
                <span className="statusLabel">Room status</span>
                <strong>{room ? room.room.status : 'No active room'}</strong>
              </div>
              <div className="statusCard">
                <span className="statusLabel">Guest viewers</span>
                <strong>{guestCount}</strong>
              </div>
              {showDebugUrls && (
                <>
                  <div className="statusCard">
                    <span className="statusLabel">API</span>
                    <strong>{status.apiBaseUrl}</strong>
                  </div>
                  <div className="statusCard">
                    <span className="statusLabel">Web</span>
                    <strong>{status.webUrl}</strong>
                  </div>
                  {status.publicWebUrl && (
                    <div className="statusCard">
                      <span className="statusLabel">Public web</span>
                      <strong>{status.publicWebUrl}</strong>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </header>

        {message && <p className="notice success">{message}</p>}
        {error && <p className="notice error">{error}</p>}

        <section className="dashboardGrid">
          <div className="dashboardColumn">
            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Media library</p>
                  <h2>Reuse previous uploads</h2>
                </div>
                <button
                  className="ghostButton"
                  onClick={() => void refreshRecentMedia()}
                  type="button"
                >
                  Refresh list
                </button>
              </div>

              <p className="sectionCopy">
                Pick an existing movie from the server when you want to open a
                new session without re-uploading the video.
              </p>

              {recentMedia.kind === 'loading' && (
                <div className="emptyState">
                  Loading recent media from the server...
                </div>
              )}
              {recentMedia.kind === 'error' && (
                <div className="emptyState errorState">
                  {recentMedia.message}
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
                        <p className="mediaQueueTitle">
                          {item.originalFileName}
                        </p>
                        <span className={`mediaQueueBadge ${item.status}`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                      <p className="mediaQueueMeta">
                        Imported {formatDateTime(item.createdAt)}
                      </p>
                      <p className="mediaQueueMeta">
                        Duration {formatDuration(item.durationMs)}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {recentMedia.kind === 'success' &&
                recentMedia.data.length === 0 && (
                  <div className="emptyState">
                    No previous uploads yet. Import a movie below to start the
                    host workflow.
                  </div>
                )}
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Import movie</p>
                  <h2>Upload new media from this machine</h2>
                </div>
              </div>
              <p className="sectionCopy">
                The selected file is uploaded to the local server and processed
                into HLS for browser playback.
              </p>

              <div className="actionsRow">
                <input
                  accept="video/*,.mkv,.mp4,.mov,.avi,.webm"
                  className="hiddenInput"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setSelectedFile(nextFile);
                    setError(null);
                    setMessage(
                      nextFile ? 'Movie selected and ready to upload.' : null
                    );
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className="primaryButton"
                  disabled={hasActiveRoom}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  Pick local movie
                </button>
                <button
                  className="secondaryButton"
                  disabled={
                    !selectedFile ||
                    !status ||
                    uploadState === 'working' ||
                    hasActiveRoom
                  }
                  onClick={() => {
                    void uploadSelectedFile();
                  }}
                  type="button"
                >
                  {uploadState === 'working'
                    ? 'Uploading...'
                    : 'Upload and process'}
                </button>
              </div>

              <div className="infoCard">
                <p className="infoTitle">
                  {selectedFile?.name ?? 'No file selected yet'}
                </p>
                <p className="infoMeta">
                  {selectedFile
                    ? `${formatFileSize(selectedFile.size)}`
                    : 'Choose a movie only when you want to add a new upload to the local server.'}
                </p>
                {hasActiveRoom && (
                  <p className="infoMeta warningText">
                    The current room is still active. Close it before switching
                    to a new movie.
                  </p>
                )}
              </div>
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Current movie</p>
                  <h2>{media?.originalFileName ?? 'Nothing selected yet'}</h2>
                </div>
                {media && (
                  <span className={`mediaQueueBadge ${media.status}`}>
                    {getStatusText(media.status)}
                  </span>
                )}
              </div>

              <p className="sectionCopy">
                This panel keeps the selected movie, processing state, and
                host-only actions together.
              </p>

              <div className="metricsGrid">
                <div className="metricCard">
                  <span className="metricLabel">Duration</span>
                  <strong>{formatDuration(media?.durationMs ?? null)}</strong>
                </div>
                <div className="metricCard">
                  <span className="metricLabel">Video</span>
                  <strong>
                    {media?.videoCodec ?? 'Unknown'}
                    {media?.width && media?.height
                      ? ` �?${media.width}x${media.height}`
                      : ''}
                  </strong>
                </div>
                <div className="metricCard">
                  <span className="metricLabel">Audio</span>
                  <strong>{media?.audioCodec ?? 'Unknown'}</strong>
                </div>
                <div className="metricCard">
                  <span className="metricLabel">Processing job</span>
                  <strong>
                    {processingQueued ? 'Queued now' : 'Existing or finished'}
                  </strong>
                </div>
              </div>

              <div className="progressList">
                {getProcessingSteps(media).map((step) => (
                  <div
                    className={`progressItem ${step.state}`}
                    key={step.label}
                  >
                    <span className="progressDot" />
                    <div>
                      <p className="progressTitle">{step.label}</p>
                      <p className="progressDescription">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {media?.processingError && (
                <p className="inlineError">{media.processingError}</p>
              )}

              {media && (
                <div className="actionsRow">
                  <button
                    className="secondaryButton"
                    disabled={
                      uploadState === 'working' ||
                      deleteState === 'working' ||
                      hasActiveRoom
                    }
                    onClick={() => {
                      void retryProcessing();
                    }}
                    type="button"
                  >
                    Retry processing
                  </button>
                  <button
                    className="secondaryButton dangerButton"
                    disabled={
                      deleteState === 'working' || uploadState === 'working'
                    }
                    onClick={() => {
                      void deleteSelectedMedia();
                    }}
                    type="button"
                  >
                    {deleteState === 'working'
                      ? 'Deleting...'
                      : deleteConfirmArmed
                        ? 'Confirm delete'
                        : 'Delete movie'}
                  </button>
                </div>
              )}
            </section>

            {media && (
              <section className="surfacePanel">
                <div className="sectionHeader">
                  <div>
                    <p className="sectionEyebrow">Subtitles</p>
                    <h2>Attach and choose tracks</h2>
                  </div>
                </div>
                <p className="sectionCopy">
                  Upload <span className="fontMono">.srt</span>,{' '}
                  <span className="fontMono">.vtt</span>, or{' '}
                  <span className="fontMono">.ass</span>. The selected track can
                  be used as the room default and updated later while the room
                  is open.
                </p>

                <div className="actionsRow">
                  <input
                    accept=".srt,.vtt,.ass"
                    className="hiddenInput"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      setSelectedSubtitleFile(nextFile);
                      setError(null);
                      setMessage(
                        nextFile
                          ? 'Subtitle selected and ready to upload.'
                          : null
                      );
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
                    disabled={
                      !selectedSubtitleFile ||
                      !status ||
                      subtitleUploadState === 'working'
                    }
                    onClick={() => {
                      void uploadSelectedSubtitle();
                    }}
                    type="button"
                  >
                    {subtitleUploadState === 'working'
                      ? 'Uploading...'
                      : 'Upload subtitle'}
                  </button>
                </div>

                <div className="infoCard">
                  <p className="infoTitle">
                    {selectedSubtitleFile?.name ??
                      'No subtitle file selected for upload'}
                  </p>
                  <p className="infoMeta">
                    {selectedSubtitleFile
                      ? 'This file is ready to upload to the current movie.'
                      : subtitles.length > 0
                        ? `${subtitles.length} subtitle track${subtitles.length === 1 ? '' : 's'} already attached to this movie.`
                        : 'No subtitle tracks attached yet.'}
                  </p>
                </div>

                {subtitles.length > 0 ? (
                  <div className="subtitleList">
                    {subtitles.map((subtitle) => (
                      <div className="subtitleCard" key={subtitle.id}>
                        <div>
                          <p className="subtitleTitle">{subtitle.label}</p>
                          <p className="subtitleMeta">
                            {subtitle.format}
                            {subtitle.language ? ` �?${subtitle.language}` : ''}
                            {subtitle.isDefault ? ' �?default' : ''}
                          </p>
                        </div>
                        {selectedRoomSubtitleId === subtitle.id && (
                          <span className="pill activePill">
                            Selected for room
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="emptyState">
                    Subtitle uploads will appear here after conversion.
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="dashboardColumn">
            <section className="surfacePanel accentPanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Room controls</p>
                  <h2>Create and manage the watch room</h2>
                </div>
              </div>

              {media ? (
                <>
                  <p className="sectionCopy">
                    Room creation stays inside the desktop dashboard. The
                    selected subtitle becomes the initial room subtitle.
                  </p>

                  <div className="fieldGrid">
                    <label className="field">
                      <span className="fieldLabel">Host display name</span>
                      <input
                        className="selectInput"
                        maxLength={48}
                        onChange={(event) =>
                          setHostDisplayName(event.target.value)
                        }
                        placeholder="Host display name"
                        value={hostDisplayName}
                      />
                    </label>

                    <label className="field">
                      <span className="fieldLabel">Room expiry</span>
                      <select
                        className="selectInput"
                        onChange={(event) =>
                          setRoomExpiryHours(event.target.value)
                        }
                        value={roomExpiryHours}
                      >
                        <option value="6">Expires in 6 hours</option>
                        <option value="24">Expires in 24 hours</option>
                        <option value="72">Expires in 72 hours</option>
                        <option value="never">No expiration</option>
                      </select>
                    </label>

                    <label className="field fieldSpan">
                      <span className="fieldLabel">Subtitle for the room</span>
                      <select
                        className="selectInput"
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setSelectedRoomSubtitleId(
                            nextValue === '__off__' ? null : nextValue
                          );
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
                    </label>
                  </div>

                  <div className="actionsRow">
                    <button
                      className="primaryButton"
                      disabled={
                        media.status !== 'ready' ||
                        roomState === 'working' ||
                        hasActiveRoom
                      }
                      onClick={() => {
                        void createRoom();
                      }}
                      type="button"
                    >
                      {roomState === 'working'
                        ? 'Creating room...'
                        : 'Create room'}
                    </button>

                    {room && (
                      <button
                        className="secondaryButton"
                        disabled={
                          roomSubtitleState === 'working' ||
                          selectedRoomSubtitleId === room.room.activeSubtitleId
                        }
                        onClick={() => {
                          void updateRoomSubtitle();
                        }}
                        type="button"
                      >
                        {roomSubtitleState === 'working'
                          ? 'Updating...'
                          : 'Update room subtitle'}
                      </button>
                    )}
                  </div>

                  {media.status !== 'ready' && (
                    <div className="emptyState">
                      Finish media processing before creating a room.
                    </div>
                  )}
                </>
              ) : (
                <div className="emptyState">
                  Select a movie first. Room controls appear once the host has
                  an active media selection.
                </div>
              )}
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Room overview</p>
                  <h2>{room ? 'Current room state' : 'No room yet'}</h2>
                </div>
              </div>

              {room ? (
                <>
                  <div className="metricsGrid">
                    <div className="metricCard">
                      <span className="metricLabel">Token</span>
                      <strong>{room.room.token}</strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Status</span>
                      <strong>{room.room.status}</strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Subtitle</span>
                      <strong>{activeRoomSubtitle?.label ?? 'None'}</strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Expires</span>
                      <strong>
                        {room.room.expiresAt
                          ? formatDateTime(room.room.expiresAt)
                          : 'No expiration'}
                      </strong>
                    </div>
                  </div>

                  <div className="infoCard">
                    <p className="infoTitle">
                      {room.media?.originalFileName ?? 'No media attached'}
                    </p>
                    <p className="infoMeta">
                      Playback state: {room.room.playbackState} at{' '}
                      {room.room.currentPlaybackTime.toFixed(2)}s
                    </p>
                    <p className="infoMeta">
                      Last state update:{' '}
                      {formatDateTime(room.room.lastStateUpdatedAt)}
                    </p>
                  </div>
                </>
              ) : (
                <div className="emptyState">
                  Create a room to make the secret link, participant state, and
                  subtitle sync visible here.
                </div>
              )}
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Share</p>
                  <h2>Copy room URLs</h2>
                </div>
              </div>

              {room ? (
                <div className="shareList">
                  <div className="shareCard">
                    <span className="shareLabel">
                      Configured secret room URL
                    </span>
                    <p className="shareValue">{room.shareUrl}</p>
                    <button
                      className="ghostButton"
                      onClick={() => void copyText(room.shareUrl)}
                      type="button"
                    >
                      Copy configured URL
                    </button>
                  </div>

                  {roomPlayerUrl && (
                    <div className="shareCard">
                      <span className="shareLabel">Local room URL</span>
                      <p className="shareValue">{roomPlayerUrl}</p>
                      <button
                        className="ghostButton"
                        onClick={() => void copyText(roomPlayerUrl)}
                        type="button"
                      >
                        Copy local URL
                      </button>
                    </div>
                  )}

                  {secondaryRoomPlayerUrl && (
                    <div className="shareCard">
                      <span className="shareLabel">{secondaryRoomLabel}</span>
                      <p className="shareValue">{secondaryRoomPlayerUrl}</p>
                      <button
                        className="ghostButton"
                        onClick={() => void copyText(secondaryRoomPlayerUrl)}
                        type="button"
                      >
                        {secondaryRoomCopyLabel}
                      </button>
                    </div>
                  )}

                  {hostRoomPlayerUrl && (
                    <div className="shareCard">
                      <span className="shareLabel">Local host room URL</span>
                      <p className="shareValue">{hostRoomPlayerUrl}</p>
                      <button
                        className="ghostButton"
                        onClick={() => void copyText(hostRoomPlayerUrl)}
                        type="button"
                      >
                        Copy local host URL
                      </button>
                    </div>
                  )}

                  {secondaryHostRoomPlayerUrl && (
                    <div className="shareCard">
                      <span className="shareLabel">
                        {secondaryHostRoomLabel}
                      </span>
                      <p className="shareValue">{secondaryHostRoomPlayerUrl}</p>
                      <button
                        className="ghostButton"
                        onClick={() => void copyText(secondaryHostRoomPlayerUrl)}
                        type="button"
                      >
                        {secondaryHostRoomCopyLabel}
                      </button>
                    </div>
                  )}

                  {showDebugUrls && (
                    <>
                      {playerUrl && (
                        <div className="shareCard">
                          <span className="shareLabel">
                            Local player preview
                          </span>
                          <p className="shareValue">{playerUrl}</p>
                          <button
                            className="ghostButton"
                            onClick={() => void copyText(playerUrl)}
                            type="button"
                          >
                            Copy player URL
                          </button>
                        </div>
                      )}

                      {secondaryPlayerUrl && (
                        <div className="shareCard">
                          <span className="shareLabel">
                            {secondaryPlayerLabel}
                          </span>
                          <p className="shareValue">{secondaryPlayerUrl}</p>
                          <button
                            className="ghostButton"
                            onClick={() => void copyText(secondaryPlayerUrl)}
                            type="button"
                          >
                            {secondaryPlayerCopyLabel}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="emptyState">
                  Share URLs appear after room creation.
                </div>
              )}
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Participants</p>
                  <h2>Presence and connection state</h2>
                </div>
              </div>

              {room ? (
                participants.length > 0 ? (
                  <div className="participantList">
                    {participants.map((participant) => (
                      <div className="participantCard" key={participant.id}>
                        <div className="participantHeader">
                          <div className="participantIdentity">
                            <p className="participantName">
                              {participant.displayName}
                            </p>
                          </div>
                          <div className="participantBadges">
                            <span className="pill">
                              {getParticipantRoleLabel(participant)}
                            </span>
                            <span
                              className={`pill ${participant.connectionState === 'connected' ? 'activePill' : 'mutedPill'}`}
                            >
                              {getParticipantConnectionLabel(participant)}
                            </span>
                          </div>
                        </div>
                        <div className="participantTimeline">
                          <p className="participantMeta">
                            Joined {formatDateTime(participant.joinedAt)}
                          </p>
                          <p className="participantMeta">
                            Last seen {formatDateTime(participant.lastSeenAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="emptyState">
                    Waiting for participants to join this room.
                  </div>
                )
              ) : (
                <div className="emptyState">
                  Participant status becomes visible once a room has been
                  created.
                </div>
              )}
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Host summary</p>
                  <h2>Current session selection</h2>
                </div>
              </div>
              <div className="infoCard">
                <p className="infoTitle">
                  {media?.originalFileName ?? 'No movie selected'}
                </p>
                <p className="infoMeta">
                  Planned room subtitle: {selectedSubtitle?.label ?? 'None'}
                </p>
                <p className="infoMeta">
                  Room action:{' '}
                  {room
                    ? 'Manage current room'
                    : 'Create a new room once media is ready'}
                </p>
              </div>
            </section>

            <section className="surfacePanel">
              <div className="sectionHeader">
                <div>
                  <p className="sectionEyebrow">Diagnostics</p>
                  <h2>Server health and cleanup policy</h2>
                </div>
                <button
                  className="ghostButton"
                  onClick={() => void refreshDiagnostics()}
                  type="button"
                >
                  Refresh diagnostics
                </button>
              </div>

              {health.kind === 'success' && systemStatus.kind === 'success' ? (
                <>
                  <div className="metricsGrid">
                    <div className="metricCard">
                      <span className="metricLabel">Server health</span>
                      <strong>{health.data.status}</strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Uptime</span>
                      <strong>{health.data.uptimeSeconds}s</strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Active rooms</span>
                      <strong>
                        {systemStatus.data.diagnostics.activeRooms}
                      </strong>
                    </div>
                    <div className="metricCard">
                      <span className="metricLabel">Processing jobs</span>
                      <strong>
                        {systemStatus.data.diagnostics.activeProcessingJobs}
                      </strong>
                    </div>
                  </div>

                  <div className="infoCard">
                    <p className="infoTitle">Cleanup policy</p>
                    <p className="infoMeta">
                      Interval: every{' '}
                      {systemStatus.data.cleanup.intervalMinutes} minutes
                    </p>
                    <p className="infoMeta">
                      Idle room TTL:{' '}
                      {systemStatus.data.cleanup.idleRoomTtlMinutes} minutes
                    </p>
                    <p className="infoMeta">
                      HLS retention:{' '}
                      {systemStatus.data.cleanup.hlsRetentionHours} hours
                    </p>
                    <p className="infoMeta">
                      Last cleanup:{' '}
                      {systemStatus.data.cleanup.lastRun
                        ? formatDateTime(
                            systemStatus.data.cleanup.lastRun.finishedAt
                          )
                        : 'No cleanup pass recorded yet'}
                    </p>
                  </div>

                  <div className="infoCard">
                    <p className="infoTitle">Storage and runtime</p>
                    <p className="infoMeta">
                      Database: {systemStatus.data.database.path}
                    </p>
                    <p className="infoMeta">
                      Media dir: {systemStatus.data.storage.mediaDir}
                    </p>
                    <p className="infoMeta">
                      HLS dir: {systemStatus.data.storage.hlsDir}
                    </p>
                    <p className="infoMeta">
                      Subtitle dir: {systemStatus.data.storage.subtitleDir}
                    </p>
                  </div>
                </>
              ) : health.kind === 'error' || systemStatus.kind === 'error' ? (
                <div className="emptyState errorState">
                  {health.kind === 'error'
                    ? health.message
                    : systemStatus.kind === 'error'
                      ? systemStatus.message
                      : 'Diagnostics failed'}
                </div>
              ) : (
                <div className="emptyState">
                  Loading diagnostics from the local server...
                </div>
              )}
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}






