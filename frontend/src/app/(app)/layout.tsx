import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getMe } from '@/lib/server-api';

/** Every page in this group needs a signed-in user; visitors are sent to sign in (FR-004). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/sign-in');

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 16px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
        <strong>CodeLens</strong>
        <span>
          {me.login} <SignOutButton csrfToken={me.csrfToken} />
        </span>
      </header>
      {children}
    </div>
  );
}
