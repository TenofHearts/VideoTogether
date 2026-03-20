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

type DashboardView = 'operations' | 'monitoring';

type ShareLink = {
    label: string;
    value: string;
    buttonLabel: string;
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

function getSharedStoragePath(paths: string[]): string {
    const normalizedPaths = paths
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => value.replace(/\\/g, '/').replace(/\/+$/, ''));

    if (normalizedPaths.length === 0) {
        return 'Unknown';
    }

    let sharedPrefix = normalizedPaths[0];

    for (const nextPath of normalizedPaths.slice(1)) {
        while (sharedPrefix && !nextPath.startsWith(sharedPrefix)) {
            sharedPrefix = sharedPrefix.slice(0, -1);
        }
    }

    const lastSeparatorIndex = sharedPrefix.lastIndexOf('/');
    const sharedDirectory =
        lastSeparatorIndex >= 0 ? sharedPrefix.slice(0, lastSeparatorIndex) : sharedPrefix;

    if (!sharedDirectory) {
        return paths[0] ?? 'Unknown';
    }

    return paths[0]?.includes('\\')
        ? sharedDirectory.replace(/\//g, '\\')
        : sharedDirectory;
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
    const roomSubtitleFieldRef = useRef<HTMLDivElement | null>(null);
    const [activeView, setActiveView] = useState<DashboardView>('operations');
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
    const [isRoomSubtitleMenuOpen, setIsRoomSubtitleMenuOpen] = useState(false);
    const [media, setMedia] = useState<Media | null>(null);
    const [monitoringMedia, setMonitoringMedia] = useState<Media | null>(null);
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
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copyToast, setCopyToast] = useState<string | null>(null);
    const [isWindowMaximized, setIsWindowMaximized] = useState(false);
    const [isWindowFocused, setIsWindowFocused] = useState(true);

    const hasActiveRoom = room?.room.status === 'active';
    const localRoomPlayerUrl =
        room && status ? buildRoomPlayerUrl(status.webUrl, room.room.token) : null;
    const publicRoomPlayerUrl =
        room && status?.publicWebUrl
            ? buildRoomPlayerUrl(status.publicWebUrl, room.room.token)
            : null;
    const lanRoomPlayerUrl =
        room && status?.lanWebUrl
            ? buildRoomPlayerUrl(status.lanWebUrl, room.room.token)
            : null;
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
        ? 'ngrok player preview'
        : 'LAN player preview';
    const secondaryPlayerCopyLabel = publicPlayerUrl
        ? 'Copy ngrok player URL'
        : 'Copy LAN player URL';
    const selectedSubtitle =
        subtitles.find((subtitle) => subtitle.id === selectedRoomSubtitleId) ??
        null;
    const roomSubtitleOptions = [
        { value: '__off__', label: 'No subtitle' },
        ...subtitles.map((subtitle) => ({
            value: subtitle.id,
            label: `${subtitle.label} (${subtitle.format})`
        }))
    ];
    const selectedRoomSubtitleOption =
        roomSubtitleOptions.find(
            (option) => option.value === (selectedRoomSubtitleId ?? '__off__')
        ) ?? roomSubtitleOptions[0];
    const activeRoomSubtitle =
        room?.subtitles.find(
            (subtitle) => subtitle.id === room.room.activeSubtitleId
        ) ?? null;
    const participants = room?.participants ?? [];
    const guestCount = participants.filter(
        (participant) => participant.role === 'guest'
    ).length;
    const connectedParticipantCount = participants.filter(
        (participant) => participant.connectionState === 'connected'
    ).length;
    const monitoringTarget = monitoringMedia ?? room?.media ?? null;
    const operationStatusText = media ? getStatusText(media.status) : 'No media selected';
    const monitoringStatusText = monitoringTarget
        ? getStatusText(monitoringTarget.status)
        : 'No target selected';
    const storageFolderPath =
        systemStatus.kind === 'success'
            ? getSharedStoragePath([
                systemStatus.data.storage.mediaDir,
                systemStatus.data.storage.hlsDir,
                systemStatus.data.storage.subtitleDir
            ])
            : 'Unknown';
    const shareLinks: ShareLink[] = [];

    if (room) {
        if (lanRoomPlayerUrl) {
            shareLinks.push({
                label: 'LAN room URL',
                value: lanRoomPlayerUrl,
                buttonLabel: 'Copy LAN room URL'
            });
        }

        if (hostRoomPlayerUrl) {
            shareLinks.push({
                label: 'Local host URL',
                value: hostRoomPlayerUrl,
                buttonLabel: 'Copy local host URL'
            });
        }
    }
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
        let cancelled = false;
        let unlisteners: Array<() => void> = [];

        async function setupWindowChrome() {
            if (!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
                return;
            }

            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const appWindow = getCurrentWindow();
            await appWindow.setDecorations(false);

            const [maximized, focused] = await Promise.all([
                appWindow.isMaximized(),
                appWindow.isFocused()
            ]);

            if (cancelled) {
                return;
            }

            setIsWindowMaximized(maximized);
            setIsWindowFocused(focused);

            unlisteners = [
                await appWindow.onResized(async () => {
                    setIsWindowMaximized(await appWindow.isMaximized());
                }),
                await appWindow.onFocusChanged(({ payload }) => {
                    setIsWindowFocused(payload);
                })
            ];
        }

        void setupWindowChrome().catch(() => undefined);

        return () => {
            cancelled = true;
            unlisteners.forEach((unlisten) => unlisten());
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
        function handleRoomSubtitlePointerDown(event: PointerEvent) {
            if (
                roomSubtitleFieldRef.current &&
                !roomSubtitleFieldRef.current.contains(event.target as Node)
            ) {
                setIsRoomSubtitleMenuOpen(false);
            }
        }

        if (!isRoomSubtitleMenuOpen) {
            return;
        }

        window.addEventListener('pointerdown', handleRoomSubtitlePointerDown);
        return () => {
            window.removeEventListener('pointerdown', handleRoomSubtitlePointerDown);
        };
    }, [isRoomSubtitleMenuOpen]);

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
                    setMonitoringMedia((current) =>
                        current?.id === nextMedia.id ? nextMedia : current
                    );

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
        if (
            !status ||
            !monitoringMedia ||
            monitoringMedia.id === media?.id ||
            (monitoringMedia.status !== 'pending' &&
                monitoringMedia.status !== 'processing')
        ) {
            return;
        }

        let cancelled = false;
        const timer = window.setInterval(() => {
            void fetchMediaById(monitoringMedia.id)
                .then((nextMedia) => {
                    if (cancelled) {
                        return;
                    }

                    setMonitoringMedia(nextMedia);

                    if (
                        nextMedia.status === 'ready' ||
                        nextMedia.status === 'error'
                    ) {
                        void refreshRecentMedia();
                    }
                })
                .catch((reason) => {
                    if (!cancelled) {
                        setError(
                            reason instanceof Error
                                ? reason.message
                                : 'Failed to refresh monitoring target'
                        );
                    }
                });
        }, 4000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [status, monitoringMedia, media?.id]);

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
                    setMonitoringMedia((current) =>
                        current?.id && payload.media && current.id === payload.media.id
                            ? payload.media
                            : current
                    );
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

    useEffect(() => {
        if (!copyToast) {
            return;
        }

        const timer = window.setTimeout(() => {
            setCopyToast(null);
        }, 2200);

        return () => {
            window.clearTimeout(timer);
        };
    }, [copyToast]);

    async function handleWindowControl(
        action: 'minimize' | 'toggleMaximize' | 'close'
    ) {
        if (!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
            return;
        }

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();

        if (action === 'minimize') {
            await appWindow.minimize();
            return;
        }

        if (action === 'toggleMaximize') {
            await appWindow.toggleMaximize();
            setIsWindowMaximized(await appWindow.isMaximized());
            return;
        }

        await appWindow.close();
    }

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
        setSubtitles([]);
        setSelectedSubtitleFile(null);
        setSelectedRoomSubtitleId(null);

        try {
            const payload = await fetchMediaById(mediaId);
            setMedia(payload);
            setMonitoringMedia((current) =>
                current?.id === payload.id || current === null ? payload : current
            );
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

    async function selectMonitoringMedia(mediaId: string) {
        if (!status) {
            return;
        }

        setError(null);
        setMessage('Loading the selected monitoring target...');

        try {
            const payload = await fetchMediaById(mediaId);
            setMonitoringMedia(payload);
            setMessage('Monitoring Target updated.');
        } catch (reason) {
            setError(
                reason instanceof Error
                    ? reason.message
                    : 'Failed to load monitoring target'
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
            setMonitoringMedia((current) =>
                current?.id === payload.media.id || current === null
                    ? payload.media
                    : current
            );
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
            setMonitoringMedia((current) =>
                current?.id === payload.media?.id || current === null
                    ? payload.media
                    : current
            );
            setRoomState('success');
            setSelectedRoomSubtitleId(payload.room.activeSubtitleId);
            await refreshDiagnostics();
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
            setMonitoringMedia((current) =>
                current?.id === payload.media?.id ? payload.media : current
            );
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
            await refreshDiagnostics();
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
            setMonitoringMedia((current) =>
                current?.id === payload.media.id ? payload.media : current
            );
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

    async function copyText(value: string, toastLabel = 'Copied to clipboard.') {
        try {
            await navigator.clipboard.writeText(value);
            setCopyToast(toastLabel);
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
            setMessage(
                `Click delete again to remove ${media.originalFileName}, all generated playback files, and any active room.`
            );
            return;
        }

        setDeleteState('working');
        setDeleteConfirmArmed(false);
        setError(null);
        setMessage(
            'Deleting media, subtitles, playback files, and active rooms...'
        );

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

            setMonitoringMedia((current) =>
                current?.id === media.id ? null : current
            );
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
            await Promise.all([refreshRecentMedia(), refreshDiagnostics()]);
        } catch (reason) {
            setDeleteState('error');
            setError(reason instanceof Error ? reason.message : 'Delete failed');
        }
    }
    function renderMediaLibrary(viewMode: DashboardView) {
        const isOperations = viewMode === 'operations';
        const selectedId = isOperations ? media?.id : monitoringTarget?.id;
        const handleSelect = isOperations ? selectExistingMedia : selectMonitoringMedia;

        return (
            <section
                className={`surfacePanel ${isOperations ? 'opsLibrary' : 'monitorLibrary'
                    }`}
            >
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Media Library</p>
                        <h2>Previous Uploads</h2>
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
                    {isOperations
                        ? 'Browse media that is already on this host and continue the room setup flow from here.'
                        : 'Browse media on this host and choose a file to inspect in the monitoring view.'}
                </p>

                {recentMedia.kind === 'loading' && (
                    <div className="emptyState">
                        Loading recent media from the server...
                    </div>
                )}
                {recentMedia.kind === 'error' && (
                    <div className="emptyState errorState">{recentMedia.message}</div>
                )}

                {recentMedia.data.length > 0 && (
                    <div className="mediaQueue">
                        {recentMedia.data.map((item) => (
                            <button
                                className={`mediaQueueItem${selectedId === item.id ? ' selected' : ''
                                    }`}
                                key={item.id}
                                onClick={() => {
                                    void handleSelect(item.id);
                                }}
                                type="button"
                            >
                                <div className="mediaQueueHeader">
                                    <p className="mediaQueueTitle">{item.originalFileName}</p>
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

                {recentMedia.kind === 'success' && recentMedia.data.length === 0 && (
                    <div className="emptyState">
                        No previous uploads yet. Import a movie to seed the dashboard.
                    </div>
                )}

                {isOperations && media && (
                    <div className="actionsRow secondaryActionsRow">
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
        );
    }

    function renderImportMovieSection() {
        return (
            <section className="surfacePanel opsImport">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Import Movie</p>
                        <h2>Upload New Media From This Machine</h2>
                    </div>
                </div>
                <p className="sectionCopy">
                    Import is isolated to the operational workflow. The selected file is
                    uploaded to the local server and processed into HLS for browser
                    playback.
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

                <div className="infoCard emphasisCard">
                    <p className="infoTitle">
                        {selectedFile?.name ?? 'No file selected yet'}
                    </p>
                    <p className="infoMeta">
                        {selectedFile
                            ? formatFileSize(selectedFile.size)
                            : 'Pick a file only when you want to add a new upload to the host machine.'}
                    </p>
                    {hasActiveRoom && (
                        <p className="infoMeta warningText">
                            The current room is still active. Close it before switching to a
                            new movie.
                        </p>
                    )}
                </div>
            </section>
        );
    }

    function renderSubtitlesSection() {
        return (
            <section className="surfacePanel opsSubtitles">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Subtitles</p>
                        <h2>Attach And Choose Tracks</h2>
                    </div>
                </div>
                <p className="sectionCopy">
                    This is the workflow midpoint: attach subtitle metadata to the current
                    operational movie, then choose the track that should ship into the room.
                </p>

                {media ? (
                    <>
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

                        <div className="infoCard compactInfoCard">
                            <p className="infoTitle">
                                {selectedSubtitleFile?.name ??
                                    'No subtitle file selected for upload'}
                            </p>
                            <p className="infoMeta">
                                {selectedSubtitleFile
                                    ? 'This file is ready to attach to the operational movie.'
                                    : subtitles.length > 0
                                        ? `${subtitles.length} subtitle track${subtitles.length === 1 ? '' : 's'} already attached.`
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
                                                {subtitle.language
                                                    ? ` · ${subtitle.language}`
                                                    : ''}
                                                {subtitle.isDefault ? ' · default' : ''}
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
                    </>
                ) : (
                    <div className="emptyState">
                        Select an operational movie first. Subtitle attachment stays idle
                        until the workflow has an input movie.
                    </div>
                )}
            </section>
        );
    }

    function renderRoomControlsSection() {
        return (
            <section className="surfacePanel accentPanel opsControls">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Room Controls</p>
                        <h2>Create And Manage The Watch Room</h2>
                    </div>
                    {room && (
                        <span className={`pill ${hasActiveRoom ? 'activePill' : 'mutedPill'}`}>
                            {room.room.status}
                        </span>
                    )}
                </div>

                {media ? (
                    <>
                        <p className="sectionCopy">
                            This is the workflow terminus. Create the room from the current
                            movie, then manage subtitle sync and lifecycle here.
                        </p>

                        <div className="metricsGrid denseMetricsGrid">
                            <div className="metricCard">
                                <span className="metricLabel">Selected Movie</span>
                                <strong>{media.originalFileName}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Processing State</span>
                                <strong>{operationStatusText}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Queue Signal</span>
                                <strong>
                                    {processingQueued
                                        ? 'Queued now'
                                        : media.status === 'pending' ||
                                            media.status === 'processing'
                                            ? 'Existing job running'
                                            : 'Idle'}
                                </strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Duration</span>
                                <strong>{formatDuration(media.durationMs)}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Subtitle Plan</span>
                                <strong>{selectedSubtitle?.label ?? 'No subtitle'}</strong>
                            </div>
                        </div>

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

                            <div className="field fieldSpan roomSubtitleField" ref={roomSubtitleFieldRef}>
                                <span className="fieldLabel">Subtitle for the room</span>
                                <button
                                    aria-expanded={isRoomSubtitleMenuOpen}
                                    className={`selectInput roomSubtitleTrigger ${isRoomSubtitleMenuOpen ? 'isOpen' : ''}`}
                                    onClick={() =>
                                        setIsRoomSubtitleMenuOpen((current) => !current)
                                    }
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setIsRoomSubtitleMenuOpen(false);
                                        }
                                    }}
                                    type="button"
                                >
                                    <span>{selectedRoomSubtitleOption?.label ?? 'No subtitle'}</span>
                                    <span
                                        aria-hidden="true"
                                        className={`roomSubtitleChevron ${isRoomSubtitleMenuOpen ? 'isOpen' : ''}`}
                                    />
                                </button>
                                {isRoomSubtitleMenuOpen && (
                                    <div className="roomSubtitleMenu" role="listbox">
                                        {roomSubtitleOptions.map((option) => {
                                            const isSelected =
                                                option.value ===
                                                (selectedRoomSubtitleId ?? '__off__');

                                            return (
                                                <button
                                                    aria-selected={isSelected}
                                                    className={`roomSubtitleOption ${isSelected ? 'isSelected' : ''}`}
                                                    key={option.value}
                                                    onClick={() => {
                                                        setSelectedRoomSubtitleId(
                                                            option.value === '__off__'
                                                                ? null
                                                                : option.value
                                                        );
                                                        setIsRoomSubtitleMenuOpen(false);
                                                    }}
                                                    role="option"
                                                    type="button"
                                                >
                                                    <span>{option.label}</span>
                                                    {isSelected && (
                                                        <span aria-hidden="true" className="roomSubtitleCheck">
                                                            Active
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="actionsRow">
                            <button
                                className="primaryButton"
                                disabled={
                                    media.status !== 'ready' || roomState === 'working'
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
                                        : 'Close room'}
                                </button>
                            )}
                        </div>

                        {media.status !== 'ready' && (
                            <div className="emptyState">
                                Finish media processing before creating a room.
                            </div>
                        )}

                        {room && (
                            <div className="infoCard compactInfoCard">
                                <p className="infoTitle">Room token {room.room.token}</p>
                                <p className="infoMeta">
                                    Playback {room.room.playbackState} at{' '}
                                    {room.room.currentPlaybackTime.toFixed(2)}s
                                </p>
                                <p className="infoMeta">
                                    Active subtitle {activeRoomSubtitle?.label ?? 'None'}
                                </p>
                            </div>
                        )}


                    </>
                ) : (
                    <div className="emptyState">
                        Select a movie first. Room Controls stay dormant until the
                        operational workflow has an active media selection.
                    </div>
                )}
            </section>
        );
    }

    function renderShareSection() {
        return (
            <section className="surfacePanel opsShare">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Share</p>
                        <h2>Copy Room URLs</h2>
                    </div>
                </div>
                <p className="sectionCopy">
                    Share output is separated from room creation. Once the room exists,
                    copy URLs from here and distribute them without leaving the dashboard.
                </p>

                {room ? (
                    <div className="shareList">
                        {shareLinks.map((link) => (
                            <div className="shareCard" key={link.label}>
                                <span className="shareLabel">{link.label}</span>
                                <p className="shareValue">{link.value}</p>
                                <button
                                    className="ghostButton"
                                    onClick={() =>
                                        void copyText(link.value, `${link.label} copied.`)
                                    }
                                    type="button"
                                >
                                    {link.buttonLabel}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="emptyState">
                        Share URLs appear after room creation.
                    </div>
                )}
            </section>
        );
    }
    function renderCurrentMovieSection() {
        return (
            <section className="surfacePanel monitorCurrentMovie">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Current Movie</p>
                        <h2>
                            {monitoringTarget?.originalFileName ??
                                'No monitoring target selected'}
                        </h2>
                    </div>
                    {monitoringTarget && (
                        <span className={`mediaQueueBadge ${monitoringTarget.status}`}>
                            {monitoringStatusText}
                        </span>
                    )}
                </div>

                {monitoringTarget ? (
                    <>
                        <p className="sectionCopy">
                            This module is the observability probe for the selected target.
                            It reports core media attributes, queue state, and HLS readiness
                            without exposing operational controls.
                        </p>

                        <div className="metricsGrid">
                            <div className="metricCard">
                                <span className="metricLabel">Duration</span>
                                <strong>{formatDuration(monitoringTarget.durationMs)}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Container</span>
                                <strong>{monitoringTarget.container ?? 'Unknown'}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Video</span>
                                <strong>{monitoringTarget.videoCodec ?? 'Unknown'}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Audio</span>
                                <strong>{monitoringTarget.audioCodec ?? 'Unknown'}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Resolution</span>
                                <strong>
                                    {monitoringTarget.width && monitoringTarget.height
                                        ? `${monitoringTarget.width} x ${monitoringTarget.height}`
                                        : 'Unknown'}
                                </strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Imported</span>
                                <strong>{formatDateTime(monitoringTarget.createdAt)}</strong>
                            </div>
                        </div>

                        <div className="progressList compactProgressList">
                            {getProcessingSteps(monitoringTarget).map((step) => (
                                <div className={`progressItem ${step.state}`} key={step.label}>
                                    <span className="progressDot" />
                                    <div>
                                        <p className="progressTitle">{step.label}</p>
                                        <p className="progressDescription">
                                            {step.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="infoCard compactInfoCard">
                            <p className="infoTitle">Queue and output</p>
                            <p className="infoMeta">Status: {monitoringStatusText}</p>
                            <p className="infoMeta">
                                HLS manifest:{' '}
                                {monitoringTarget.hlsManifestPath ?? 'Not generated yet'}
                            </p>
                            {monitoringTarget.processingError && (
                                <p className="infoMeta warningText">
                                    Error: {monitoringTarget.processingError}
                                </p>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="emptyState">
                        Pick a video from the monitoring media library to inspect media
                        attributes and processing state.
                    </div>
                )}
            </section>
        );
    }

    function renderRoomOverviewSection() {
        return (
            <section className="surfacePanel monitorOverview">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Room Overview</p>
                        <h2>{room ? 'Current Room State' : 'No Room Yet'}</h2>
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
                                <span className="metricLabel">Playback</span>
                                <strong>{room.room.playbackState}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Guests</span>
                                <strong>{guestCount}</strong>
                            </div>
                        </div>

                        <div className="infoCard compactInfoCard">
                            <p className="infoTitle">
                                {room.media?.originalFileName ?? 'No media attached'}
                            </p>
                            <p className="infoMeta">
                                Playback time {room.room.currentPlaybackTime.toFixed(2)}s
                            </p>
                            <p className="infoMeta">
                                Last state update {formatDateTime(room.room.lastStateUpdatedAt)}
                            </p>
                            <p className="infoMeta">
                                Subtitle {activeRoomSubtitle?.label ?? 'None'}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="emptyState">
                        Create a room in the operational view to populate lifecycle and
                        playback telemetry here.
                    </div>
                )}
            </section>
        );
    }

    function renderHostSummarySection() {
        return (
            <section className="surfacePanel monitorHostSummary">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Host Summary</p>
                        <h2>Current Session Selection</h2>
                    </div>
                </div>

                <div className="infoCard compactInfoCard">
                    <p className="infoTitle">
                        {hostParticipant?.displayName ?? hostDisplayName}
                    </p>
                    <p className="infoMeta">
                        Session media {room?.media?.originalFileName ?? 'No active session'}
                    </p>
                    <p className="infoMeta">
                        Host route {hostRoomPlayerUrl ? 'Provisioned' : 'Not provisioned'}
                    </p>
                    <p className="infoMeta">
                        Current monitoring target{' '}
                        {monitoringTarget?.originalFileName ?? 'None selected'}
                    </p>
                </div>

                <div className="metricsGrid denseMetricsGrid">
                    <div className="metricCard">
                        <span className="metricLabel">Connected Participants</span>
                        <strong>{connectedParticipantCount}</strong>
                    </div>
                    <div className="metricCard">
                        <span className="metricLabel">Selected Subtitle</span>
                        <strong>{activeRoomSubtitle?.label ?? 'None'}</strong>
                    </div>
                </div>
            </section>
        );
    }

    function renderParticipantsSection() {
        return (
            <section className="surfacePanel monitorParticipants">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Participants</p>
                        <h2>Presence And Connection State</h2>
                    </div>
                </div>

                {room ? (
                    participants.length > 0 ? (
                        <div className="participantList participantGrid">
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
                                                className={`pill ${participant.connectionState ===
                                                        'connected'
                                                        ? 'activePill'
                                                        : 'mutedPill'
                                                    }`}
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
                        Participant topology appears once a room is active.
                    </div>
                )}
            </section>
        );
    }

    function renderDiagnosticsSection() {
        return (
            <section className="surfacePanel monitorDiagnostics">
                <div className="sectionHeader">
                    <div>
                        <p className="sectionEyebrow">Diagnostics</p>
                        <h2>Server Health</h2>
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
                        <div className="metricsGrid diagnosticsMetricsGrid">
                            <div className="metricCard">
                                <span className="metricLabel">Server Health</span>
                                <strong>{health.data.status}</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Uptime</span>
                                <strong>{health.data.uptimeSeconds}s</strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Active Rooms</span>
                                <strong>
                                    {systemStatus.data.diagnostics.activeRooms}
                                </strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Processing Jobs</span>
                                <strong>
                                    {systemStatus.data.diagnostics.activeProcessingJobs}
                                </strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Connected Clients</span>
                                <strong>
                                    {systemStatus.data.diagnostics.connectedParticipants}
                                </strong>
                            </div>
                            <div className="metricCard">
                                <span className="metricLabel">Ready Media</span>
                                <strong>{systemStatus.data.diagnostics.readyMedia}</strong>
                            </div>
                        </div>

                        <div className="infoCard compactInfoCard">
                            <p className="infoTitle">Storage folder</p>
                            <p className="infoMeta fontMono">{storageFolderPath}</p>
                            {status && showDebugUrls && (
                                <>
                                    <p className="infoMeta">API {status.apiBaseUrl}</p>
                                    <p className="infoMeta">Web {status.webUrl}</p>
                                    {status.publicWebUrl && (
                                        <p className="infoMeta">
                                            Public web {status.publicWebUrl}
                                        </p>
                                    )}
                                </>
                            )}
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
        );
    }

    const viewTitle =
        activeView === 'operations'
            ? 'Operational View'
            : 'Monitoring View';
    const viewDescription =
        activeView === 'operations'
            ? 'Work through the hosting flow step by step: pick media, prepare subtitles, create a room, and share access with viewers.'
            : 'Check the current host session, room state, participants, and media diagnostics without changing the active workflow.';

    return (
        <main className={`shell ${isWindowMaximized ? 'shellMaximized' : ''}`}>
            <header
                className={`windowChrome ${isWindowFocused ? 'isFocused' : 'isBlurred'}`}
            >
                <div
                    className="windowChromeBrand"
                    data-tauri-drag-region
                    onDoubleClick={() => void handleWindowControl('toggleMaximize')}
                >
                    <span className="windowChromeMark" aria-hidden="true" />
                    <div className="windowChromeCopy" data-tauri-drag-region>
                        <strong>VideoTogether</strong>
                        <p className="windowChromeEyebrow">Desktop host console</p>
                    </div>
                </div>


                <div className="windowControls" aria-label="Window controls">
                    <button
                        aria-label="Minimize window"
                        className="windowControlButton"
                        onClick={(event) => {
                            event.stopPropagation();
                            void handleWindowControl('minimize');
                        }}
                        type="button"
                    >
                        <span className="windowControlIcon minimize" aria-hidden="true" />
                    </button>
                    <button
                        aria-label={isWindowMaximized ? 'Restore window' : 'Maximize window'}
                        className="windowControlButton"
                        onClick={(event) => {
                            event.stopPropagation();
                            void handleWindowControl('toggleMaximize');
                        }}
                        type="button"
                    >
                        <span
                            className={`windowControlIcon ${isWindowMaximized ? 'restore' : 'maximize'}`}
                            aria-hidden="true"
                        />
                    </button>
                    <button
                        aria-label="Close window"
                        className="windowControlButton closeButton"
                        onClick={(event) => {
                            event.stopPropagation();
                            void handleWindowControl('close');
                        }}
                        type="button"
                    >
                        <span className="windowControlIcon close" aria-hidden="true" />
                    </button>
                </div>
            </header>

            <section className="panel dashboardShell">
                <header className="appBar">
                    <div className="appBarBrand">

                        <h1>Dual-view host console</h1>
                        <p className="copy">
                            Switch between action flow and telemetry flow without mixing the
                            two interaction models.
                        </p>
                    </div>

                    <div className="viewToggle" role="tablist" aria-label="Dashboard view">
                        <button
                            aria-selected={activeView === 'operations'}
                            className={`toggleButton ${activeView === 'operations' ? 'active' : ''
                                }`}
                            onClick={() => setActiveView('operations')}
                            role="tab"
                            type="button"
                        >
                            Operational View
                        </button>
                        <button
                            aria-selected={activeView === 'monitoring'}
                            className={`toggleButton ${activeView === 'monitoring' ? 'active' : ''
                                }`}
                            onClick={() => setActiveView('monitoring')}
                            role="tab"
                            type="button"
                        >
                            Monitoring View
                        </button>
                    </div>

                    <div className="appBarStatus">
                        <span className="appPill">Room {room?.room.status ?? 'idle'}</span>
                        <span className="appPill">Guests {guestCount}</span>
                        <span className="appPill">Ops {operationStatusText}</span>
                        <span className="appPill">Probe {monitoringStatusText}</span>
                    </div>
                </header>

                <section className="viewHero">
                    <div className="viewHeroCopy">
                        <p className="sectionEyebrow">{viewTitle}</p>
                        <h2>
                            {viewTitle === 'Operational View'
                                ? 'Run The Hosting Workflow'
                                : 'Monitor Session And System Status'}
                        </h2>
                        <p className="sectionCopy">{viewDescription}</p>
                    </div>

                    {status && (
                        <div className="statusRail">
                            <div className="statusCard">
                                <span className="statusLabel">Tauri</span>
                                <strong>{status.tauri}</strong>
                            </div>
                            <div className="statusCard">
                                <span className="statusLabel">Operational Movie</span>
                                <strong>{media?.originalFileName ?? 'None selected'}</strong>
                            </div>
                            <div className="statusCard">
                                <span className="statusLabel">Monitoring Target</span>
                                <strong>
                                    {monitoringTarget?.originalFileName ?? 'None selected'}
                                </strong>
                            </div>
                            <div className="statusCard">
                                <span className="statusLabel">Connected Viewers</span>
                                <strong>{connectedParticipantCount}</strong>
                            </div>
                        </div>
                    )}
                </section>

                {message && <p className="notice success">{message}</p>}
                {error && <p className="notice error">{error}</p>}

                {activeView === 'operations' ? (
                    <section className="workspaceGrid operationsGrid">
                        <div className="workspaceColumn">
                            {renderMediaLibrary('operations')}
                            {renderImportMovieSection()}
                            {renderSubtitlesSection()}
                            <div
                                aria-hidden="true"
                                className="surfacePanel workspaceSpacer"
                            />
                        </div>
                        <div className="workspaceColumn">
                            {renderRoomControlsSection()}
                            {renderShareSection()}
                            <div
                                aria-hidden="true"
                                className="surfacePanel workspaceSpacer"
                            />
                        </div>
                    </section>
                ) : (
                    <section className="workspaceGrid monitoringGrid">
                        <div className="workspaceColumn">
                            {renderMediaLibrary('monitoring')}
                            {renderHostSummarySection()}
                            {renderParticipantsSection()}
                            <div
                                aria-hidden="true"
                                className="surfacePanel workspaceSpacer"
                            />
                        </div>
                        <div className="workspaceColumn">
                            {renderCurrentMovieSection()}
                            <div
                                aria-hidden="true"
                                className="surfacePanel workspaceSpacer"
                            />
                        </div>
                        <div className="workspaceColumn">
                            {renderRoomOverviewSection()}
                            {renderDiagnosticsSection()}
                            <div
                                aria-hidden="true"
                                className="surfacePanel workspaceSpacer"
                            />
                        </div>
                    </section>
                )}
            </section>

            {copyToast && (
                <div className="copyToast" role="status" aria-live="polite">
                    {copyToast}
                </div>
            )}
        </main>
    );
}


