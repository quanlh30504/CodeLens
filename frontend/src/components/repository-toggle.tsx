'use client';

import { useState } from 'react';
import { ApiError, apiFetch, setCsrfToken } from '@/lib/api-client';
import { REPOSITORY_STATE_LABELS, Repository, RepositoryState } from '@/lib/installation-states';
import { CONFIRM_WITH_GITHUB_URL, Failure, OWNERS_ONLY_MESSAGE, describeFailure, optimisticState } from '@/lib/management';

interface Props {
  repository: Pick<Repository, 'id' | 'fullName' | 'state'>;
  canManage: boolean;
}

/**
 * Enable or disable review for one repository (FR-021). The new state shows at once and is put back
 * if the server refuses. A member sees the control as unavailable with the reason (FR-040); an
 * owner whose role GitHub has not confirmed recently is sent through GitHub to confirm it (FR-037).
 */
export function RepositoryToggle({ repository, canManage }: Props) {
  const [state, setState] = useState<RepositoryState>(repository.state);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  if (repository.state === 'INACCESSIBLE' || state === 'INACCESSIBLE') {
    return <span>{REPOSITORY_STATE_LABELS.INACCESSIBLE}</span>;
  }

  if (!canManage) {
    return (
      <span>
        {REPOSITORY_STATE_LABELS[state]}{' '}
        <button type="button" disabled aria-describedby={`owners-only-${repository.id}`}>
          {state === 'ENABLED' ? 'Disable' : 'Enable'}
        </button>{' '}
        <small id={`owners-only-${repository.id}`}>{OWNERS_ONLY_MESSAGE}</small>
      </span>
    );
  }

  async function change(enable: boolean) {
    const previous = state;
    setFailure(null);
    setBusy(true);
    setState(optimisticState(previous, enable));
    try {
      const me = await apiFetch<{ csrfToken: string }>('/me');
      setCsrfToken(me.csrfToken);
      const updated = await apiFetch<Repository>(`/repositories/${repository.id}/review-enabled`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: enable }),
      });
      setState(updated.state);
    } catch (error) {
      setState(previous); // put back what was really saved
      setFailure(describeFailure(error instanceof ApiError || error instanceof Error ? error : new Error('unknown')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      {REPOSITORY_STATE_LABELS[state]}{' '}
      <button type="button" disabled={busy} onClick={() => change(state !== 'ENABLED')}>
        {state === 'ENABLED' ? 'Disable' : 'Enable'} CodeLens
      </button>
      {failure ? (
        <span role="alert">
          {' '}
          {failure.message}{' '}
          {failure.kind === 'reauth' ? <a href={CONFIRM_WITH_GITHUB_URL}>Confirm with GitHub</a> : null}
        </span>
      ) : null}
    </span>
  );
}
