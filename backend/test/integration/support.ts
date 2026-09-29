import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { FakeGithub } from '../fakes/fake-github';
import type { Infra } from './harness';
import type { World } from './scenario';

export interface SignedIn {
  cookie: string;
  csrfToken: string;
  userId: string;
}

/** Performs the complete browser sign-in against the API and the fake GitHub. */
export async function signIn(app: INestApplication, github: FakeGithub, githubUserId: number): Promise<SignedIn> {
  const server = app.getHttpServer();
  const start = await request(server).get('/api/auth/github/login').expect(302);
  const authorize = new URL(start.headers.location);
  const state = authorize.searchParams.get('state')!;
  const stateCookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

  const callback = await request(server)
    .get('/api/auth/github/callback')
    .query({ code: github.authCode(githubUserId), state })
    .set('Cookie', stateCookie)
    .expect(302);
  const sessionCookie = (callback.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('codelens_session='));
  if (!sessionCookie) throw new Error(`sign-in failed: redirected to ${callback.headers.location}`);

  const me = await request(server).get('/api/me').set('Cookie', sessionCookie).expect(200);
  return { cookie: sessionCookie, csrfToken: me.body.csrfToken, userId: me.body.id };
}

/** Signs in a GitHub user that exists in the fake (creating it if needed). */
export async function signInAs(world: World, githubUserId: number): Promise<SignedIn> {
  if (!world.github.users.has(githubUserId)) world.github.addUser({ id: githubUserId, login: `user-${githubUserId}` });
  return signIn(world.app, world.github, githubUserId);
}

export async function eventually<T>(check: () => Promise<T | false | null | undefined>, timeoutMs = 20000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function resetData(infra: Infra): Promise<void> {
  await infra.prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, repositories, github_installations, organization_members, organizations, users, webhook_deliveries RESTART IDENTITY CASCADE',
  );
}

/** Starts installation and returns the state GitHub would send back. */
export async function startInstall(app: INestApplication, session: SignedIn): Promise<{ state: string; location: string }> {
  const response = await request(app.getHttpServer()).get('/api/installations/new').set('Cookie', session.cookie).expect(302);
  const location = response.headers.location as string;
  return { state: new URL(location).searchParams.get('state')!, location };
}

/** The browser returning from GitHub after installation, with GitHub's one-time authorization code. */
export function returnFromGithub(
  app: INestApplication,
  session: SignedIn,
  query: { installation_id?: number | string; state: string; code?: string; error?: string },
) {
  return request(app.getHttpServer()).get('/api/installations/callback').query(query).set('Cookie', session.cookie);
}

export async function completeInstall(
  app: INestApplication,
  github: FakeGithub,
  session: SignedIn,
  githubUserId: number,
  installationId: number,
) {
  const { state } = await startInstall(app, session);
  return returnFromGithub(app, session, {
    installation_id: installationId,
    state,
    code: github.authCode(githubUserId),
  });
}

/** Signs the user in, installs, and waits until the first synchronization has finished. */
export async function installAndSync(
  world: World,
  githubUserId: number,
  installationId: number,
): Promise<{ session: SignedIn; id: string }> {
  const session = await signInAs(world, githubUserId);
  const callback = await completeInstall(world.app, world.github, session, githubUserId, installationId);
  if (callback.status !== 302) throw new Error(`install callback answered ${callback.status}`);
  const id = String(callback.headers.location).split('/').pop()!;
  await eventually(async () => {
    const r = await request(world.app.getHttpServer()).get(`/api/installations/${id}`).set('Cookie', session.cookie);
    return r.body.displayState === 'ACTIVE';
  });
  return { session, id };
}
