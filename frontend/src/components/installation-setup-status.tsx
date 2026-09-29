'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, setCsrfToken } from '@/lib/api-client';
import type { Installation } from '@/lib/installation-states';
import { pollUntil } from '@/lib/poll';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

interface Props {
  installationId: string;
  canManage: boolean;
}

/**
 * Shown while the first import of repositories is running (US2 scenario 5). It checks every 3
 * seconds for up to 2 minutes and refreshes the page by itself when the import ends. After that
 * it says setup is taking longer than expected and offers to check again; owners can also retry.
 */
export function InstallationSetupStatus({ installationId, canManage }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'slow'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    void pollUntil<Installation>({
      fetchValue: () => apiFetch<Installation>(`/installations/${installationId}`),
      isDone: (installation) => installation.displayState !== 'SETTING_UP',
      intervalMs: POLL_INTERVAL_MS,
      timeoutMs: POLL_TIMEOUT_MS,
      cancelled: () => cancelled,
    }).then((result) => {
      if (result.status === 'done') router.refresh();
      else if (result.status === 'timeout') setPhase('slow');
    });
    return () => {
      cancelled = true;
    };
  }, [installationId, attempt, router]);

  async function retrySynchronization() {
    setRetryMessage(null);
    try {
      const me = await apiFetch<{ csrfToken: string }>('/me');
      setCsrfToken(me.csrfToken);
      await apiFetch(`/installations/${installationId}/sync`, { method: 'POST' });
      setRetryMessage('Synchronization was requested.');
      setAttempt((n) => n + 1);
    } catch {
      setRetryMessage('The request could not be sent. Please try again.');
    }
  }

  if (phase === 'checking') {
    return (
      <p role="status">
        Setting up: repositories are being imported from GitHub. This page updates by itself.
      </p>
    );
  }

  return (
    <div role="status">
      <p>Setup is taking longer than expected.</p>
      <button type="button" onClick={() => setAttempt((n) => n + 1)}>
        Check again
      </button>{' '}
      {canManage ? (
        <button type="button" onClick={retrySynchronization}>
          Retry synchronization
        </button>
      ) : null}
      {retryMessage ? <p>{retryMessage}</p> : null}
    </div>
  );
}
