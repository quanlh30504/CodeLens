/** User-facing messages for the sign-in error codes produced by the API redirect (US1). */
export const SIGN_IN_MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled. You can try again.',
  invalid_state: 'The sign-in attempt could not be verified. Please try again.',
  github_unavailable: 'GitHub could not be reached. Please try again in a few minutes.',
  github_rejected: 'GitHub did not accept the sign-in. Please try again.',
};

export function signInMessage(code: string | string[] | undefined): string | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  return SIGN_IN_MESSAGES[code] ?? 'Sign-in failed. Please try again.';
}
