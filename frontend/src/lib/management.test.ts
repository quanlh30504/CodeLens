import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { OWNERS_ONLY_MESSAGE, describeFailure, optimisticState } from './management';

describe('optimisticState', () => {
  it('shows the requested state immediately', () => {
    expect(optimisticState('DISABLED', true)).toBe('ENABLED');
    expect(optimisticState('ENABLED', false)).toBe('DISABLED');
  });

  it('never changes a repository that is no longer accessible', () => {
    expect(optimisticState('INACCESSIBLE', true)).toBe('INACCESSIBLE');
  });
});

describe('describeFailure', () => {
  const failure = (status: number, code: string) => new ApiError(status, { code, message: 'x' });

  it('asks the owner to confirm with GitHub when the role is too old', () => {
    expect(describeFailure(failure(403, 'REAUTH_REQUIRED')).kind).toBe('reauth');
  });

  it('explains that only owners can change this', () => {
    expect(describeFailure(failure(403, 'FORBIDDEN'))).toEqual({ kind: 'forbidden', message: OWNERS_ONLY_MESSAGE });
  });

  it('explains an inaccessible repository', () => {
    expect(describeFailure(failure(409, 'CONFLICT')).kind).toBe('inaccessible');
  });

  it('says GitHub could not be reached when the role cannot be confirmed', () => {
    expect(describeFailure(failure(503, 'ROLE_UNVERIFIABLE')).message).toMatch(/could not be reached/);
  });

  it('never shows raw server text for unknown errors', () => {
    expect(describeFailure(new Error('boom: stack trace')).message).toBe('The change could not be saved. Please try again.');
    expect(describeFailure(failure(500, 'INTERNAL_ERROR')).message).not.toContain('x');
  });
});
