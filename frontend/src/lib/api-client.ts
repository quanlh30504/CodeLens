/**
 * Same-origin API client. Authentication is the httpOnly session cookie, which JavaScript cannot
 * read; no token is ever stored by the browser code. State-changing calls send the per-session
 * CSRF token obtained from GET /api/me.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

const BASE = '/api';

export async function apiFetch<T>(path: string, init: RequestInit & { method?: string } = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers.set('x-csrf-token', csrfToken);

  const response = await fetch(`${BASE}${path}`, { ...init, method, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const body =
      parsed && typeof parsed === 'object' && 'code' in parsed && 'message' in parsed
        ? (parsed as ApiErrorBody)
        : { code: 'ERROR', message: 'The request failed.' };
    throw new ApiError(response.status, body);
  }
  return parsed as T;
}
