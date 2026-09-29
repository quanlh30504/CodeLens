import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InstallationSetupStatus } from '@/components/installation-setup-status';
import { RepositoryToggle } from '@/components/repository-toggle';
import { SyncNowButton } from '@/components/sync-now-button';
import {
  INSTALLATION_STATE_LABELS,
  Installation,
  Repository,
  limitWarning,
  syncFailureReason,
} from '@/lib/installation-states';
import { serverFetch } from '@/lib/server-api';

type Params = Promise<{ id: string }>;
type Search = Promise<{ q?: string; state?: string; cursor?: string }>;

export default async function InstallationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const { q, state, cursor } = await searchParams;

  const installation = await serverFetch<Installation>(`/installations/${encodeURIComponent(id)}`);
  if (!installation) notFound();

  const query = new URLSearchParams({ limit: '50' });
  if (q) query.set('q', q);
  if (state === 'ENABLED' || state === 'DISABLED' || state === 'INACCESSIBLE') query.set('state', state);
  if (cursor) query.set('cursor', cursor);
  const repositories = await serverFetch<{ items: Repository[]; nextCursor: string | null }>(
    `/installations/${encodeURIComponent(id)}/repositories?${query.toString()}`,
  );
  const items = repositories?.items ?? [];

  const nextParams = new URLSearchParams();
  if (q) nextParams.set('q', q);
  if (state) nextParams.set('state', state);
  if (repositories?.nextCursor) nextParams.set('cursor', repositories.nextCursor);

  return (
    <main>
      <p>
        <Link href="/installations">← Installations</Link>
      </p>

      {/* Installation → Organization → Repositories (FR-019) */}
      <h1>{installation.organization.login}</h1>
      <p>
        {installation.organization.accountType === 'ORGANIZATION' ? 'Organization' : 'Personal account'} ·{' '}
        Status: <strong>{INSTALLATION_STATE_LABELS[installation.displayState]}</strong> · Access:{' '}
        {installation.repositorySelection === 'ALL' ? 'all repositories' : 'selected repositories'}
      </p>

      {installation.displayState === 'SETTING_UP' ? (
        <InstallationSetupStatus installationId={installation.id} canManage={installation.canManage} />
      ) : null}
      {installation.displayState === 'SYNC_FAILED' ? (
        <p role="alert">
          The last import from GitHub failed. {syncFailureReason(installation.syncErrorCode)} Your existing list is
          unchanged.
        </p>
      ) : null}
      {installation.displayState === 'LIMIT_REACHED' ? <p role="alert">{limitWarning()}</p> : null}
      {installation.displayState === 'SUSPENDED' ? (
        <p role="alert">This installation is suspended on GitHub. No repository is eligible until it is unsuspended.</p>
      ) : null}
      {installation.displayState === 'REMOVED' ? (
        <p role="alert">The app was uninstalled on GitHub. This is kept for your records.</p>
      ) : null}

      {installation.canManage && installation.status === 'ACTIVE' ? <SyncNowButton installationId={installation.id} /> : null}

      <h2>Repositories</h2>
      <form method="get">
        <input name="q" defaultValue={q ?? ''} placeholder="Search by name" aria-label="Search repositories" maxLength={100} />{' '}
        <select name="state" defaultValue={state ?? ''} aria-label="Filter by state">
          <option value="">All states</option>
          <option value="ENABLED">Enabled</option>
          <option value="DISABLED">Disabled</option>
          <option value="INACCESSIBLE">No longer accessible</option>
        </select>{' '}
        <button type="submit">Search</button>
      </form>

      {items.length === 0 && installation.displayState !== 'SETTING_UP' ? (
        installation.repositoryCount === 0 && !q && !state ? (
          <p>
            No repositories were selected on GitHub.{' '}
            <a href={installation.githubSettingsUrl} rel="noreferrer">
              Change the selection on GitHub
            </a>
            .
          </p>
        ) : (
          <p>No repositories match.</p>
        )
      ) : (
        <table>
          <thead>
            <tr>
              <th>Repository</th>
              <th>Visibility</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {items.map((repository) => (
              <tr key={repository.id}>
                <td>{repository.fullName}</td>
                <td>{repository.private ? 'Private' : 'Public'}</td>
                <td>
                  <RepositoryToggle repository={repository} canManage={installation.canManage && installation.status === 'ACTIVE'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {repositories?.nextCursor ? <Link href={`?${nextParams.toString()}`}>Next page</Link> : null}

      {/* CodeLens cannot widen access; that is done only on GitHub (FR-006). */}
      <p>
        <a href={installation.githubSettingsUrl} rel="noreferrer">
          Add or remove repositories on GitHub
        </a>
      </p>
    </main>
  );
}
