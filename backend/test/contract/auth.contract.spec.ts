import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeGithub } from '../fakes/fake-github';
import { Infra, startApi, startInfra } from '../integration/harness';
import { signIn } from '../integration/support';
import { documentedStatuses, expectMatchesContract } from './openapi';

/** Contract tests for the sign-in routes against contracts/api.openapi.yaml (FR-001, FR-004). */
describe('auth contract', () => {
  let infra: Infra;
  let github: FakeGithub;
  let app: INestApplication;

  beforeAll(async () => {
    infra = await startInfra();
    github = await new FakeGithub().start();
    github.addUser({ id: 7, login: 'octocat', email: 'octo@example.com' });
    app = await startApi(infra, github);
  });

  afterAll(async () => {
    await app.close();
    await github.stop();
    await infra.stop();
  });

  it('documents the four auth routes', () => {
    expect(documentedStatuses('/auth/github/login', 'get')).toContain('302');
    expect(documentedStatuses('/auth/github/callback', 'get')).toContain('302');
    expect(documentedStatuses('/auth/logout', 'post')).toContain('204');
    expect(documentedStatuses('/me', 'get')).toEqual(expect.arrayContaining(['200', '401']));
  });

  it('GET /auth/github/login redirects to GitHub authorization with client id, callback and state', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/github/login').expect(302);
    const location = new URL(response.headers.location);
    expect(location.pathname).toBe('/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/auth/github/callback');
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('GET /me matches the documented 200 response and 401 answer', async () => {
    const session = await signIn(app, github, 7);
    const ok = await request(app.getHttpServer()).get('/api/me').set('Cookie', session.cookie).expect(200);
    expectMatchesContract('/me', 'get', 200, ok.body);

    const denied = await request(app.getHttpServer()).get('/api/me').expect(401);
    expectMatchesContract('/me', 'get', 401, denied.body);
  });

  it('POST /auth/logout returns 204 and requires the CSRF token', async () => {
    const session = await signIn(app, github, 7);
    const missing = await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', session.cookie).expect(403);
    expect(missing.body.code).toBe('CSRF_INVALID');

    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(204);
    expectMatchesContract('/auth/logout', 'post', 204, response.body);
  });
});
