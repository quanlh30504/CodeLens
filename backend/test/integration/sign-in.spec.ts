import { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../src/auth/auth.module';
import request from 'supertest';
import { FakeGithub } from '../fakes/fake-github';
import { Infra, startApi, startInfra } from './harness';
import { resetData, signIn } from './support';

/** US1 scenarios 1 to 6 (FR-001, FR-002, FR-004). */
describe('sign in with GitHub', () => {
  let infra: Infra;
  let github: FakeGithub;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startInfra();
    github = await new FakeGithub().start();
    app = await startApi(infra, github);
  });

  afterAll(async () => {
    await app.close();
    await github.stop();
    await infra.stop();
  });

  beforeEach(async () => {
    await resetData(infra);
    github.users.clear();
    github.addUser({ id: 10, login: 'first-login', email: 'a@example.com' });
  });

  const server = () => app.getHttpServer();

  async function startLogin() {
    const start = await request(server()).get('/api/auth/github/login').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    return { state, cookie };
  }

  it('creates an account linked to the numeric GitHub id on first sign-in (scenario 1)', async () => {
    const session = await signIn(app, github, 10);
    const users = await infra.prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ githubUserId: '10', login: 'first-login', id: session.userId });
  });

  it('reuses the same account on the next sign-in (scenario 2)', async () => {
    const first = await signIn(app, github, 10);
    const second = await signIn(app, github, 10);
    expect(second.userId).toBe(first.userId);
    expect(await infra.prisma.user.count()).toBe(1);
  });

  it('keeps the account and updates the login when the GitHub username changes (scenario 3)', async () => {
    const first = await signIn(app, github, 10);
    github.addUser({ id: 10, login: 'renamed', email: 'a@example.com' });
    const second = await signIn(app, github, 10);
    expect(second.userId).toBe(first.userId);
    const me = await request(server()).get('/api/me').set('Cookie', second.cookie).expect(200);
    expect(me.body.login).toBe('renamed');
  });

  it('stays signed out and creates nothing when the user cancels at GitHub (scenario 4)', async () => {
    const { state, cookie } = await startLogin();
    const response = await request(server())
      .get('/api/auth/github/callback')
      .query({ error: 'access_denied', state })
      .set('Cookie', cookie)
      .expect(302);
    expect(response.headers.location).toBe('/sign-in?error=cancelled');
    expect(((response.headers['set-cookie'] as unknown as string[] | undefined) ?? []).join(';')).not.toContain('codelens_session=');
    expect(await infra.prisma.user.count()).toBe(0);
  });

  it('rejects a callback with a wrong, missing, reused or foreign state', async () => {
    const { state, cookie } = await startLogin();

    const wrong = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(10), state: 'not-the-state' })
      .set('Cookie', cookie)
      .expect(302);
    expect(wrong.headers.location).toBe('/sign-in?error=invalid_state');

    const noCookie = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(10), state })
      .expect(302);
    expect(noCookie.headers.location).toBe('/sign-in?error=invalid_state');

    // The state was consumed by the previous request, so even the right cookie cannot reuse it.
    const reused = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(10), state })
      .set('Cookie', cookie)
      .expect(302);
    expect(reused.headers.location).toBe('/sign-in?error=invalid_state');
    expect(await infra.prisma.user.count()).toBe(0);
  });

  it('shows a message when GitHub is unavailable or rejects the code, without creating an account', async () => {
    const { state, cookie } = await startLogin();
    const rejected = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: 'unknown-code', state })
      .set('Cookie', cookie)
      .expect(302);
    expect(rejected.headers.location).toBe('/sign-in?error=github_rejected');

    const second = await startLogin();
    github.failNext(/access_token/, 503);
    const down = await request(server())
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(10), state: second.state })
      .set('Cookie', second.cookie)
      .expect(302);
    expect(down.headers.location).toBe('/sign-in?error=github_unavailable');
    expect(await infra.prisma.user.count()).toBe(0);
  });

  it('gives unauthenticated requests 401 and no tenant data (scenario 5)', async () => {
    const response = await request(server()).get('/api/me').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED', message: expect.any(String) });
  });

  it('treats a tampered session cookie as signed out', async () => {
    const session = await signIn(app, github, 10);
    await request(server()).get('/api/me').set('Cookie', `${session.cookie}x`).expect(401);
  });

  it('sign-out ends the session on the server, and signing in again returns the same account (scenario 6)', async () => {
    const session = await signIn(app, github, 10);
    await request(server())
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(204);

    // The old cookie value is now useless, even though it is still validly signed.
    await request(server()).get('/api/me').set('Cookie', session.cookie).expect(401);

    const again = await signIn(app, github, 10);
    expect(again.userId).toBe(session.userId);
  });

  it('a session that has expired answers 401 and loses no account data (Edge Case)', async () => {
    const session = await signIn(app, github, 10);
    // Simulate the store dropping the session at the end of its lifetime.
    const redis = app.get<Redis>(REDIS);
    const keys = await redis.keys('session:*');
    expect(keys.length).toBeGreaterThan(0);
    await redis.del(...keys);

    const response = await request(server()).get('/api/me').set('Cookie', session.cookie).expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
    expect(await infra.prisma.user.count()).toBe(1);
  });
});
