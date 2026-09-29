'use client';

import { apiFetch, setCsrfToken } from '@/lib/api-client';

export function SignOutButton({ csrfToken }: { csrfToken: string }) {
  async function signOut() {
    setCsrfToken(csrfToken);
    await apiFetch('/auth/logout', { method: 'POST' });
    window.location.assign('/sign-in');
  }

  return (
    <button type="button" onClick={signOut}>
      Sign out
    </button>
  );
}
