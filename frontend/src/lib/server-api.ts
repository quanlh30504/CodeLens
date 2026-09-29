import { cookies } from 'next/headers';

export interface Me {
  id: string;
  login: string;
  avatarUrl: string | null;
  csrfToken: string;
  organizations: { id: string; login: string; role: 'OWNER' | 'MEMBER' }[];
}

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

/**
 * Server-side API access. The session cookie is forwarded from the incoming request; the server
 * component receives only the data it renders. Returns null when the visitor is signed out.
 */
export async function serverFetch<T>(path: string): Promise<T | null> {
  const cookie = (await cookies()).toString();
  const response = await fetch(`${API}/api${path}`, {
    headers: { cookie, accept: 'application/json' },
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
  return (await response.json()) as T;
}

export const getMe = () => serverFetch<Me>('/me');
