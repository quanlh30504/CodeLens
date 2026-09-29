'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, setCsrfToken } from '@/lib/api-client';
import { CONFIRM_WITH_GITHUB_URL, Failure, describeFailure } from '@/lib/management';

/** Owners can re-run the import from GitHub at any time; repeating it is harmless (FR-016). */
export function SyncNowButton({ installationId }: { installationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      const me = await apiFetch<{ csrfToken: string }>('/me');
      setCsrfToken(me.csrfToken);
      const result = await apiFetch<{ status: 'QUEUED' | 'ALREADY_QUEUED' }>(`/installations/${installationId}/sync`, {
        method: 'POST',
      });
      setMessage(result.status === 'QUEUED' ? 'Synchronization started.' : 'A synchronization is already waiting.');
      setTimeout(() => router.refresh(), 3000);
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <p>
      <button type="button" onClick={syncNow} disabled={busy}>
        Sync now
      </button>{' '}
      {message}
      {failure ? (
        <span role="alert">
          {failure.message} {failure.kind === 'reauth' ? <a href={CONFIRM_WITH_GITHUB_URL}>Confirm with GitHub</a> : null}
        </span>
      ) : null}
    </p>
  );
}
