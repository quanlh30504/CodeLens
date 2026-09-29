import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { GithubAppClient } from '../../src/github/github-app.client';
import { GithubUserClient } from '../../src/github/github-user.client';
import { openapi } from '../contract/openapi';
import { generateKeyPairSync } from 'node:crypto';
import { GithubLoginController } from '../../src/auth/github-login.controller';
import { MeController } from '../../src/auth/me.controller';
import { InstallController } from '../../src/github/install/install.controller';
import { WebhookController } from '../../src/github/webhook/webhook.controller';
import { InstallationsController } from '../../src/installations/installations.controller';
import { ManualSyncController } from '../../src/installations/manual-sync.controller';
import { ReviewEnabledController } from '../../src/repositories/review-enabled.controller';

/**
 * Feature 001 never writes to GitHub (spec FR-032) and offers no way to grant or widen access
 * (FR-006). Checked three ways: the shape of the clients, the calls they make, and the routes.
 */

const WRITE_WORDS = /^(create|update|delete|remove|merge|push|post|put|patch|comment|approve|dispatch|fork|add|set|write|commit|close|open|reopen|rerun|cancel)/i;
const FORBIDDEN_PATHS = /\/(repos|contents|pulls|issues|actions|workflows|hooks|git|branches|collaborators|keys|environments|secrets|settings|orgs\/[^/]+\/(repos|teams))(\/|$)/;

function publicMethods(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter(
    (name) => name !== 'constructor' && !name.startsWith('_') && typeof (prototype as Record<string, unknown>)[name] === 'function',
  );
}

describe('GitHub clients are read-only', () => {
  it('expose no method whose name suggests a write', () => {
    // Private helpers are compiled to ordinary methods; the request wrappers are allowed below.
    const allowedInternal = new Set(['request', 'parse', 'getJson', 'installationToken', 'appJwt']);
    for (const client of [GithubAppClient, GithubUserClient]) {
      for (const name of publicMethods(client.prototype)) {
        if (allowedInternal.has(name)) continue;
        expect(name).not.toMatch(WRITE_WORDS);
      }
    }
  });

  it('list exactly the public methods this feature needs', () => {
    const visible = (client: { prototype: object }) => publicMethods(client.prototype).filter((n) => !['request', 'parse', 'getJson', 'installationToken', 'appJwt'].includes(n)).sort();
    expect(visible(GithubAppClient)).toEqual(['getApp', 'getInstallation', 'installationHasRepository', 'listInstallationRepositories']);
    expect(visible(GithubUserClient)).toEqual(['exchangeCode', 'getUser', 'listInstallations']);
  });

  it('only ever calls GET, except the two token exchanges GitHub requires', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const calls: { method: string; path: string }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ method: init?.method ?? 'GET', path });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/access_tokens')) return json({ token: 'ghs_test', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
      if (path === '/login/oauth/access_token') return json({ access_token: 'ghu_test' });
      if (path === '/app') return json({ permissions: { metadata: 'read' } });
      if (path.startsWith('/app/installations/')) {
        return json({ id: 1, account: { id: 2, login: 'a', type: 'Organization' }, repository_selection: 'all', suspended_at: null, created_at: '2026-01-01T00:00:00Z' });
      }
      if (path === '/installation/repositories') return json({ repositories: [] });
      if (path === '/user') return json({ id: 3, login: 'u' });
      if (path === '/user/installations') return json({ installations: [] });
      return json({}, 404);
    }) as unknown as typeof fetch;

    const app = new GithubAppClient({ appId: '1', apiBaseUrl: 'https://api.test', privateKey: () => pem, fetchImpl });
    await app.getApp();
    await app.getInstallation(1);
    await app.listInstallationRepositories(1);
    await app.installationHasRepository(1, 5);
    const user = new GithubUserClient({ apiBaseUrl: 'https://api.test', webBaseUrl: 'https://web.test', clientId: 'c', clientSecret: () => 's', fetchImpl });
    await user.exchangeCode('code');
    await user.getUser('tok');
    await user.listInstallations('tok');

    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path.replace(/\d+/g, 'N')}`).sort()).toEqual([
      'POST /app/installations/N/access_tokens',
      'POST /login/oauth/access_token',
    ]);
    for (const call of calls) expect(call.path).not.toMatch(FORBIDDEN_PATHS);
  });
});

describe('the API grants or widens no repository access (FR-006)', () => {
  const controllers = [GithubLoginController, MeController, InstallController, InstallationsController, ManualSyncController, ReviewEnabledController, WebhookController];
  const verbs: Record<number, string> = {
    [RequestMethod.GET]: 'get',
    [RequestMethod.POST]: 'post',
    [RequestMethod.PUT]: 'put',
    [RequestMethod.DELETE]: 'delete',
    [RequestMethod.PATCH]: 'patch',
  };

  function implemented(): string[] {
    const routes: string[] = [];
    for (const controller of controllers) {
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as object | undefined;
        if (typeof handler !== 'function') continue; // skip getters and fields
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const template = `/${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(/:(\w+)/g, '{$1}');
        routes.push(`${verbs[method]} ${template}`);
      }
    }
    return routes.sort();
  }

  function documented(): string[] {
    const routes: string[] = [];
    for (const [path, item] of Object.entries(openapi.paths)) {
      for (const verb of Object.keys(item)) if (['get', 'post', 'put', 'delete', 'patch'].includes(verb)) routes.push(`${verb} ${path}`);
    }
    return routes.sort();
  }

  it('implements exactly the routes of the contract, no more and no fewer', () => {
    expect(implemented()).toEqual(documented());
  });

  it('has no route that changes which repositories the app can access', () => {
    for (const route of implemented()) {
      expect(route).not.toMatch(/permission|grant|access-token|repositories\/\{[^}]+\}\/(add|remove|select)/i);
    }
    // The only installation-related redirect goes to GitHub's own installation page.
    expect(implemented()).toContain('get /installations/new');
    expect(implemented().filter((r) => r.startsWith('post') || r.startsWith('put') || r.startsWith('delete') || r.startsWith('patch'))).toEqual([
      'post /auth/logout',
      'post /installations/{installationId}/sync',
      'post /webhooks/github',
      'put /repositories/{repositoryId}/review-enabled',
    ]);
  });
});
