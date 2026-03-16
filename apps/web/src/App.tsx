import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import type { ServiceHealth, SystemStatus } from '@videoshare/shared-types';
import { formatTimestamp, getApiBaseUrl } from '@videoshare/shared-utils';

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

const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });
  const [system, setSystem] = useState<SystemState>({ kind: 'loading' });
  const [socketState, setSocketState] = useState<SocketState>({
    kind: 'idle',
    message: 'Waiting for realtime bootstrap...'
  });

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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff4d9,_#fffaf2_45%,_#ffe0d2)] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-panel backdrop-blur">
          <p className="text-sm uppercase tracking-[0.35em] text-coral">
            Phase 1
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Core server foundation is live, persistent, and realtime-aware.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            This screen now verifies REST health, persistent room APIs, and a
            live Socket.IO handshake against the Fastify backend.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[2rem] bg-ink p-8 text-white shadow-panel">
            <h2 className="text-2xl font-semibold">Backend Connectivity</h2>
            <p className="mt-3 text-sm text-slate-300">
              API base URL: <span className="font-mono">{apiBaseUrl}</span>
            </p>

            {health.kind === 'loading' && (
              <div className="mt-8 rounded-2xl bg-white/10 p-5">
                Waiting for the local backend health endpoint...
              </div>
            )}

            {health.kind === 'error' && (
              <div className="mt-8 rounded-2xl border border-red-300/40 bg-red-500/15 p-5 text-red-100">
                <p className="font-medium">Backend unreachable</p>
                <p className="mt-2 text-sm">{health.message}</p>
              </div>
            )}

            {health.kind === 'success' && (
              <div className="mt-8 rounded-2xl bg-emerald-400/15 p-5 text-emerald-50">
                <p className="font-medium">Health check passed</p>
                <p className="mt-2 text-sm">
                  Service: {health.data.service}
                </p>
                <p className="mt-1 text-sm">
                  Uptime: {health.data.uptimeSeconds}s
                </p>
                <p className="mt-1 text-sm">
                  Timestamp: {formatTimestamp(health.data.timestamp)}
                </p>
              </div>
            )}

            <div className="mt-6 rounded-2xl bg-white/10 p-5">
              <p className="font-medium">Realtime handshake</p>
              <p className="mt-2 text-sm">{socketState.message}</p>
              {'socketId' in socketState && (
                <p className="mt-1 text-sm">
                  Socket ID: <span className="font-mono">{socketState.socketId}</span>
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-8 shadow-panel">
            <h2 className="text-2xl font-semibold">Phase 1 Checklist</h2>
            <ul className="mt-5 space-y-3 text-sm text-slate-700">
              <li>SQLite persistence initialized on boot</li>
              <li>Room creation and lookup APIs are live</li>
              <li>System status reports storage and database details</li>
              <li>Static media and subtitle route foundations added</li>
              <li>Socket.IO client can establish a live connection</li>
            </ul>

            {system.kind === 'success' && (
              <div className="mt-6 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">
                <p>Database: <span className="font-mono">{system.data.database.path}</span></p>
                <p className="mt-1">Realtime path: <span className="font-mono">{system.data.realtime.path}</span></p>
                <p className="mt-1">Realtime status: {system.data.realtime.status}</p>
              </div>
            )}

            {system.kind === 'error' && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {system.message}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
