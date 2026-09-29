import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CsrfGuard } from '../../src/auth/csrf.guard';
import { AuthorizationContext, resolveAuthorizationContext } from '../../src/auth/authorization-context';
import { parseCookies } from '../../src/auth/cookies';
import {
  ABSOLUTE_LIFETIME_SECONDS,
  IDLE_LIFETIME_SECONDS,
  KeyValueStore,
  SessionService,
} from '../../src/auth/session.service';
import type { SecretProvider } from '../../src/config/secret-provider';
import { TenantScopedRepository, systemScope, userScope } from '../../src/tenancy/tenant-scoped.repository';

class MemoryStore implements KeyValueStore {
  data = new Map<string, { value: string; expiresAt: number }>();
  constructor(private readonly now: () => number) {}
  async get(key: string) {
    const e = this.data.get(key);
    return e && e.expiresAt > this.now() ? e.value : null;
  }
  async set(key: string, value: string, ttl: number) {
    this.data.set(key, { value, expiresAt: this.now() + ttl });
  }
  async del(key: string) {
    this.data.delete(key);
  }
}

const secrets: SecretProvider = {
  githubAppPrivateKey: () => 'unused',
  githubClientSecret: () => 'unused',
  githubWebhookSecret: () => 'unused',
  sessionSecret: () => 'test-only-session-secret',
  assertAllPresent: () => undefined,
};

function harness() {
  let now = 1_000_000;
  const clock = () => now;
  const store = new MemoryStore(clock);
  const service = new SessionService(store, secrets, clock);
  return { service, store, advance: (s: number) => (now += s) };
}

describe('SessionService', () => {
  it('creates a session that resolves from its cookie value', async () => {
    const { service } = harness();
    const { cookieValue } = await service.create('user-1');
    const resolved = await service.resolve(cookieValue);
    expect(resolved?.session.userId).toBe('user-1');
  });

  it('rejects missing, malformed and tampered cookie values', async () => {
    const { service } = harness();
    const { cookieValue } = await service.create('user-1');
    const [id, sig] = cookieValue.split('.');
    expect(await service.resolve(undefined)).toBeNull();
    expect(await service.resolve('garbage')).toBeNull();
    expect(await service.resolve(`${id}.${sig.slice(1)}x`)).toBeNull();
    expect(await service.resolve(`other.${sig}`)).toBeNull();
  });

  it('expires after 2 hours without use (idle limit)', async () => {
    const { service, advance } = harness();
    const { cookieValue } = await service.create('user-1');
    advance(IDLE_LIFETIME_SECONDS - 1);
    expect(await service.resolve(cookieValue)).not.toBeNull();
    advance(IDLE_LIFETIME_SECONDS);
    expect(await service.resolve(cookieValue)).toBeNull();
  });

  it('expires 12 hours after creation even if used constantly (absolute limit)', async () => {
    const { service, advance } = harness();
    const { cookieValue } = await service.create('user-1');
    for (let elapsed = 0; elapsed < ABSOLUTE_LIFETIME_SECONDS - 3600; elapsed += 3600) {
      advance(3600);
      expect(await service.resolve(cookieValue)).not.toBeNull();
    }
    advance(3600);
    expect(await service.resolve(cookieValue)).toBeNull();
  });

  it('treats a destroyed session as signed out', async () => {
    const { service } = harness();
    const { cookieValue } = await service.create('user-1');
    await service.destroy(cookieValue);
    expect(await service.resolve(cookieValue)).toBeNull();
  });

  it('does not store the session identifier or any credential in the store keys/values', async () => {
    const { service, store } = harness();
    const { cookieValue } = await service.create('user-1');
    const id = cookieValue.split('.')[0];
    for (const [key, entry] of store.data) {
      expect(key).not.toContain(id);
      expect(entry.value).not.toMatch(/githubToken|accessToken|secret/i);
    }
  });
});

describe('parseCookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; codelens_session=abc.def; b=2')).toEqual({ a: '1', codelens_session: 'abc.def', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });
});

function httpContext(request: object): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  const auth = { session: { csrfToken: 'csrf-token-value' } };

  it('allows safe methods without a token', () => {
    expect(guard.canActivate(httpContext({ method: 'GET', headers: {}, auth }))).toBe(true);
  });

  it('accepts a matching token on state-changing methods', () => {
    const request = { method: 'POST', headers: { 'x-csrf-token': 'csrf-token-value' }, auth };
    expect(guard.canActivate(httpContext(request))).toBe(true);
  });

  it.each([['PUT'], ['POST'], ['DELETE'], ['PATCH']])('rejects %s without or with a wrong token', (method) => {
    expect(() => guard.canActivate(httpContext({ method, headers: {}, auth }))).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(httpContext({ method, headers: { 'x-csrf-token': 'wrong' }, auth })),
    ).toThrow(ForbiddenException);
  });

  it('answers 401 when there is no session', () => {
    expect(() => guard.canActivate(httpContext({ method: 'POST', headers: {} }))).toThrow(UnauthorizedException);
  });
});

describe('AuthorizationContext', () => {
  it('is built from the database memberships, not from the request', async () => {
    const context = await resolveAuthorizationContext(
      { findMemberships: async () => [{ organizationId: 'org-1', role: 'OWNER', roleVerifiedAt: null }] },
      'user-1',
    );
    expect(context).toEqual({
      userId: 'user-1',
      memberships: [{ organizationId: 'org-1', role: 'OWNER', roleVerifiedAt: null }],
    });
  });
});

class ExampleRepository extends TenantScopedRepository {
  pick = <T extends { organizationId: string }>(scope: ReturnType<typeof userScope>, row: T | null) =>
    this.requireInScope(scope, row);
  where = (scope: ReturnType<typeof userScope>) => this.organizationFilter(scope);
}

describe('TenantScopedRepository', () => {
  const context: AuthorizationContext = {
    userId: 'u1',
    memberships: [{ organizationId: 'org-a', role: 'MEMBER', roleVerifiedAt: null }],
  };
  const repo = new ExampleRepository();

  it('limits queries to the caller organizations', () => {
    expect(repo.where(userScope(context))).toEqual({ organizationId: { in: ['org-a'] } });
    expect(repo.where(systemScope('org-z'))).toEqual({ organizationId: { in: ['org-z'] } });
  });

  it('returns rows inside the scope and "not found" for rows outside it or missing', () => {
    expect(repo.pick(userScope(context), { organizationId: 'org-a' })).toEqual({ organizationId: 'org-a' });
    expect(() => repo.pick(userScope(context), { organizationId: 'org-b' })).toThrow(NotFoundException);
    expect(() => repo.pick(userScope(context), null)).toThrow(NotFoundException);
  });

  it('gives an identical error for missing and out-of-scope rows', () => {
    const errors = [
      () => repo.pick(userScope(context), { organizationId: 'org-b' }),
      () => repo.pick(userScope(context), null),
    ].map((fn) => {
      try {
        fn();
        return null;
      } catch (e) {
        return (e as NotFoundException).getResponse();
      }
    });
    expect(errors[0]).toEqual(errors[1]);
  });

  it('requires a system scope to name an organization', () => {
    expect(() => systemScope('')).toThrow();
  });
});
