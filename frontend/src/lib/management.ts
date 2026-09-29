import { ApiError } from './api-client';
import type { RepositoryState } from './installation-states';

export const OWNERS_ONLY_MESSAGE = 'Only organization owners can change this.';

/** What the toggle shows right after a click, before the server answers (reverted on failure). */
export function optimisticState(current: RepositoryState, enable: boolean): RepositoryState {
  if (current === 'INACCESSIBLE') return current;
  return enable ? 'ENABLED' : 'DISABLED';
}

export type FailureKind = 'reauth' | 'forbidden' | 'inaccessible' | 'other';

export interface Failure {
  kind: FailureKind;
  message: string;
}

/** Turns an API error into a message and, for REAUTH_REQUIRED, the "confirm with GitHub" step. */
export function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.body.code === 'REAUTH_REQUIRED') {
      return { kind: 'reauth', message: 'Please confirm your access with GitHub, then try again.' };
    }
    if (error.status === 403) return { kind: 'forbidden', message: OWNERS_ONLY_MESSAGE };
    if (error.status === 409) {
      return { kind: 'inaccessible', message: 'This repository is no longer accessible on GitHub.' };
    }
    if (error.body.code === 'ROLE_UNVERIFIABLE') {
      return { kind: 'other', message: 'GitHub could not be reached to confirm your access. Please try again shortly.' };
    }
  }
  return { kind: 'other', message: 'The change could not be saved. Please try again.' };
}

/** Where the "confirm with GitHub" step sends the person: through GitHub authorization again. */
export const CONFIRM_WITH_GITHUB_URL = '/api/me/refresh-access';
