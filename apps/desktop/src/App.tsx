import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import type { DesktopStatus } from '@videoshare/shared-types';

export default function App() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<DesktopStatus>('get_local_status')
      .then(setStatus)
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Tauri Shell</p>
        <h1>Host dashboard foundation</h1>
        <p className="copy">
          This desktop shell is ready for file picking, room creation, and local
          service controls in the next phases.
        </p>

        {status && (
          <dl className="statusGrid">
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

        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
