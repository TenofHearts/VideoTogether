import { useEffect, useState } from 'react';

import type { ServiceHealth } from '@videoshare/shared-types';
import { formatTimestamp, getApiBaseUrl } from '@videoshare/shared-utils';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; data: ServiceHealth };

const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

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

    void loadHealth();
    const timer = window.setInterval(() => {
      void loadHealth();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff4d9,_#fffaf2_45%,_#ffe0d2)] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-8 shadow-panel backdrop-blur">
          <p className="text-sm uppercase tracking-[0.35em] text-coral">
            Phase 0
          </p>
          <h1 className="mt-4 max-w-3xl font-serif text-4xl font-semibold leading-tight md:text-6xl">
            Private watch party foundation for a two-person movie room.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            This starter UI proves the frontend can reach the local Fastify
            backend and gives us a base for the host dashboard and room
            experience.
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
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-8 shadow-panel">
            <h2 className="text-2xl font-semibold">Phase 0 Checklist</h2>
            <ul className="mt-5 space-y-3 text-sm text-slate-700">
              <li>Monorepo workspace scaffolded</li>
              <li>Fastify health endpoint in place</li>
              <li>React + Vite + Tailwind frontend wired</li>
              <li>Tauri desktop shell scaffolded</li>
              <li>Docker Compose prepared for server runtime</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
