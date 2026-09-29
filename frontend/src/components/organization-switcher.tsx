'use client';

import { useRouter } from 'next/navigation';

interface Props {
  organizations: { id: string; login: string }[];
  selected: string | undefined;
}

/**
 * Lets a person in several organizations look at one at a time. The list comes from the API,
 * which returns only the caller's own organizations (FR-020); nothing else can be chosen.
 */
export function OrganizationSwitcher({ organizations, selected }: Props) {
  const router = useRouter();
  if (organizations.length < 2) return null;

  return (
    <label>
      Organization{' '}
      <select
        value={selected ?? ''}
        onChange={(event) => router.push(event.target.value ? `/installations?org=${event.target.value}` : '/installations')}
      >
        <option value="">All my organizations</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.login}
          </option>
        ))}
      </select>
    </label>
  );
}
