import { describe, expect, it } from 'vitest';
import {
  INSTALLATION_STATE_LABELS,
  REPOSITORY_STATE_LABELS,
  SYNC_FAILURE_REASONS,
  limitWarning,
  noticeMessage,
  syncFailureReason,
} from './installation-states';

describe('installation states (spec FR-041)', () => {
  it('has a label for each of the six installation states', () => {
    expect(Object.keys(INSTALLATION_STATE_LABELS).sort()).toEqual(
      ['ACTIVE', 'LIMIT_REACHED', 'REMOVED', 'SETTING_UP', 'SUSPENDED', 'SYNC_FAILED'],
    );
  });

  it('labels repositories Enabled, Disabled or No longer accessible', () => {
    expect(Object.values(REPOSITORY_STATE_LABELS)).toEqual(['Enabled', 'Disabled', 'No longer accessible']);
  });

  it('explains the four failure reasons and never repeats GitHub text', () => {
    expect(Object.keys(SYNC_FAILURE_REASONS).sort()).toEqual(['ACCESS_REVOKED', 'GITHUB_RATE_LIMITED', 'GITHUB_UNAVAILABLE', 'OTHER']);
    expect(syncFailureReason('GITHUB_UNAVAILABLE')).toMatch(/could not be reached/);
    expect(syncFailureReason('anything else')).toBe(SYNC_FAILURE_REASONS.OTHER);
    expect(syncFailureReason(null)).toBe(SYNC_FAILURE_REASONS.OTHER);
  });

  it('states the repository limit and that others are not shown', () => {
    expect(limitWarning()).toMatch(/5,000/);
    expect(limitWarning()).toMatch(/not shown/);
  });

  it('only shows known notices', () => {
    expect(noticeMessage('not_confirmed')).toMatch(/nothing was linked/);
    expect(noticeMessage('<b>x</b>')).toBeNull();
    expect(noticeMessage(undefined)).toBeNull();
  });
});
