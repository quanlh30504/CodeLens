import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SecretProvider } from '../config/secret-provider';

export const SESSION_COOKIE_NAME = 'codelens_session';
export const ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60;
export const IDLE_LIFETIME_SECONDS = 2 * 60 * 60;

export interface SessionData {
  userId: string;
  csrfToken: string;
  createdAt: number; // epoch seconds
  lastSeenAt: number; // epoch seconds
}

/** Minimal key-value contract, implemented by Redis in production and in-memory in unit tests. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export type Clock = () => number; // epoch seconds

const systemClock: Clock = () => Math.floor(Date.now() / 1000);

/**
 * Server-side sessions (research R3). The browser holds only an opaque, signed identifier in an
 * httpOnly cookie. All data lives in the store. Limits: 12 hours absolute, 2 hours idle (FR-036).
 * No GitHub credential is ever stored in a session.
 */
export class SessionService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly secrets: SecretProvider,
    private readonly now: Clock = systemClock,
  ) {}

  /** Creates a session and returns the cookie value to set. */
  async create(userId: string): Promise<{ cookieValue: string; session: SessionData }> {
    const id = randomBytes(32).toString('base64url');
    const now = this.now();
    const session: SessionData = {
      userId,
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt: now,
      lastSeenAt: now,
    };
    await this.store.set(this.key(id), JSON.stringify(session), IDLE_LIFETIME_SECONDS);
    return { cookieValue: `${id}.${this.sign(id)}`, session };
  }

  /** Returns the live session for a cookie value, or null (invalid, tampered, expired, revoked). */
  async resolve(cookieValue: string | undefined): Promise<{ id: string; session: SessionData } | null> {
    const id = this.verify(cookieValue);
    if (!id) return null;

    const raw = await this.store.get(this.key(id));
    if (!raw) return null;

    const session = JSON.parse(raw) as SessionData;
    const now = this.now();
    const expired =
      now - session.createdAt >= ABSOLUTE_LIFETIME_SECONDS || now - session.lastSeenAt >= IDLE_LIFETIME_SECONDS;
    if (expired) {
      await this.store.del(this.key(id));
      return null;
    }

    session.lastSeenAt = now;
    const remainingAbsolute = ABSOLUTE_LIFETIME_SECONDS - (now - session.createdAt);
    await this.store.set(this.key(id), JSON.stringify(session), Math.min(IDLE_LIFETIME_SECONDS, remainingAbsolute));
    return { id, session };
  }

  /** Revokes a session on the server (sign-out). Later requests with the cookie are signed out. */
  async destroy(cookieValue: string | undefined): Promise<void> {
    const id = this.verify(cookieValue);
    if (id) await this.store.del(this.key(id));
  }

  private key(id: string): string {
    return `session:${createHash('sha256').update(id).digest('hex')}`;
  }

  private sign(id: string): string {
    return createHmac('sha256', this.secrets.sessionSecret()).update(id).digest('base64url');
  }

  private verify(cookieValue: string | undefined): string | null {
    if (!cookieValue) return null;
    const dot = cookieValue.indexOf('.');
    if (dot <= 0) return null;
    const id = cookieValue.slice(0, dot);
    const given = Buffer.from(cookieValue.slice(dot + 1));
    const expected = Buffer.from(this.sign(id));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return id;
  }
}
