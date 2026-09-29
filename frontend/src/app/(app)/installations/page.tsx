import Link from 'next/link';
import { INSTALLATION_STATE_LABELS, Installation, noticeMessage } from '@/lib/installation-states';
import { serverFetch } from '@/lib/server-api';

export default async function InstallationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const { notice } = await searchParams;
  const message = noticeMessage(notice);
  const data = await serverFetch<{ items: Installation[] }>('/installations');
  const installations = data?.items ?? [];

  return (
    <main>
      <h1>GitHub installations</h1>
      {message ? <p role="alert">{message}</p> : null}

      {/* The installation itself happens on GitHub; the user never handles a token. */}
      <p>
        <a href="/api/installations/new">Install CodeLens</a>
      </p>

      {installations.length === 0 ? (
        <p>
          No installations yet. Choose “Install CodeLens”, pick the account and the repositories on GitHub, and
          they will appear here.
        </p>
      ) : (
        <ul>
          {installations.map((installation) => (
            <li key={installation.id}>
              <Link href={`/installations/${installation.id}`}>{installation.organization.login}</Link>{' '}
              — {INSTALLATION_STATE_LABELS[installation.displayState]}
              {installation.status !== 'REMOVED' ? ` · ${installation.repositoryCount} repositories` : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
