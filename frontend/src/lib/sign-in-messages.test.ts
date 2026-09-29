import { describe, expect, it } from 'vitest';
import { SIGN_IN_MESSAGES, signInMessage } from './sign-in-messages';

describe('signInMessage', () => {
  it('returns nothing when there is no error', () => {
    expect(signInMessage(undefined)).toBeNull();
    expect(signInMessage('')).toBeNull();
    expect(signInMessage(['a', 'b'])).toBeNull();
  });

  it('offers a way to try again for a cancelled sign-in', () => {
    expect(signInMessage('cancelled')).toMatch(/cancelled/i);
    expect(signInMessage('cancelled')).toMatch(/try again/i);
  });

  it('has a distinct message for every code the API can send', () => {
    const codes = ['cancelled', 'invalid_state', 'github_unavailable', 'github_rejected'];
    expect(Object.keys(SIGN_IN_MESSAGES).sort()).toEqual([...codes].sort());
    expect(new Set(codes.map((c) => signInMessage(c))).size).toBe(codes.length);
  });

  it('never echoes unknown input back into the page', () => {
    expect(signInMessage('<script>alert(1)</script>')).toBe('Sign-in failed. Please try again.');
  });
});
