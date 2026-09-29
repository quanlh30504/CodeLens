import { createHash, randomBytes } from 'node:crypto';
import type { Clock, KeyValueStore } from './session.service';

export type StatePurpose = 'login' | 'install' | 'install-confirm';
export const STATE_TTL_SECONDS = 10 * 60;

interface StoredState {
  purpose: StatePurpose;
  sessionId: string | null;
  createdAt: number;
  payload: Record<string, string> | null;
}

/**
 * Single-use `state` values for the GitHub authorization and installation redirects
 * (research R2). A value is random, expires after 10 minutes, can be consumed once, and can be
 * bound to a session so it cannot be used from another browser.
 */
export class OAuthStateService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: Clock = () => Math.floor(Date.now() / 1000),
  ) {}

  async create(
    purpose: StatePurpose,
    sessionId: string | null = null,
    payload: Record<string, string> | null = null,
  ): Promise<string> {
    const state = randomBytes(24).toString('base64url');
    const value: StoredState = { purpose, sessionId, createdAt: this.now(), payload };
    await this.store.set(this.key(state), JSON.stringify(value), STATE_TTL_SECONDS);
    return state;
  }

  /** Returns true exactly once for a valid, unexpired value of the right purpose and session. */
  async consume(state: string | undefined, purpose: StatePurpose | StatePurpose[], sessionId: string | null = null): Promise<boolean> {
    return (await this.consumeWithPayload(state, purpose, sessionId)) !== null;
  }

  /** Like consume(), but returns the payload stored with the state (or null when invalid). */
  async consumeWithPayload(
    state: string | undefined,
    purpose: StatePurpose | StatePurpose[],
    sessionId: string | null = null,
  ): Promise<{ payload: Record<string, string> | null } | null> {
    if (!state || state.length > 200) return null;
    const key = this.key(state);
    const raw = await this.store.get(key);
    if (!raw) return null;
    await this.store.del(key); // single use, even when the checks below fail
    const stored = JSON.parse(raw) as StoredState;
    if (this.now() - stored.createdAt >= STATE_TTL_SECONDS) return null;
    const accepted = Array.isArray(purpose) ? purpose : [purpose];
    if (!accepted.includes(stored.purpose) || stored.sessionId !== sessionId) return null;
    return { payload: stored.payload };
  }

  private key(state: string): string {
    return `oauth-state:${createHash('sha256').update(state).digest('hex')}`;
  }
}
