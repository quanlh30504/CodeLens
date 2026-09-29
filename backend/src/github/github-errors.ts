/** Reason categories shown to users for a failed synchronization (spec FR-041). */
export type GithubErrorCode = 'GITHUB_UNAVAILABLE' | 'GITHUB_RATE_LIMITED' | 'ACCESS_REVOKED' | 'OTHER';

/**
 * Error from talking to GitHub. The message is ours and never contains upstream response text
 * (research R12, spec FR-017): only the category is safe to show or store.
 */
export class GithubError extends Error {
  constructor(
    readonly code: GithubErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

export function classifyStatus(status: number, rateLimitRemaining?: string | null): GithubErrorCode {
  if (status === 429 || (status === 403 && rateLimitRemaining === '0')) return 'GITHUB_RATE_LIMITED';
  if (status === 401 || status === 403) return 'ACCESS_REVOKED';
  if (status >= 500 || status === 408) return 'GITHUB_UNAVAILABLE';
  return 'OTHER';
}
