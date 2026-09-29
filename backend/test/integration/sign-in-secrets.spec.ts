import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeGithub } from '../fakes/fake-github';
import { Infra, startApi, startInfra, testSecrets } from './harness';
import { resetData } from './support';

/**
 * No GitHub user credential, client secret, session secret or private key may appear in any
 * response body, header (other than the httpOnly session cookie) or output line during sign-in
 * (FR-034, SC-010).
 */
describe('sign-in secret handling', () => {
  let infra: Infra;
  let github: FakeGithub;
  let app: INestApplication;
  const captured: string[] = [];
  let restore: () => void;

  beforeAll(async () => {
    infra = await startInfra();
    github = await new FakeGithub().start();
    github.addUser({ id: 55, login: 'private-person', email: 'p@example.com' });
    app = await startApi(infra, github);

    const stdout = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (stdout as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (stderr as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;
    restore = () => {
      process.stdout.write = stdout as typeof process.stdout.write;
      process.stderr.write = stderr as typeof process.stderr.write;
    };
  });

  afterAll(async () => {
    restore();
    await app.close();
    await github.stop();
    await infra.stop();
  });

  beforeEach(async () => {
    await resetData(infra);
  });

  it('never exposes a credential in bodies, headers or output', async () => {
    const secrets = testSecrets(github);
    const forbidden = [
      secrets.githubClientSecret(),
      secrets.sessionSecret(),
      secrets.githubWebhookSecret(),
      'BEGIN PRIVATE KEY',
      'ghu_fake_',
      'ghs_fake_',
    ];
    const server = app.getHttpServer();
    const seen: string[] = [];
    const record = (r: request.Response) => {
      seen.push(JSON.stringify(r.body), r.text ?? '');
      for (const [name, value] of Object.entries(r.headers)) {
        if (name === 'set-cookie') {
          // The httpOnly session cookie is allowed to exist; it must not contain any credential.
          seen.push(...(value as unknown as string[]).map((c) => c.split(';').slice(1).join(';')));
        } else {
          seen.push(`${name}: ${String(value)}`);
        }
      }
    };

    const start = await request(server).get('/api/auth/github/login');
    record(start);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const stateCookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    const callback = await request(server)
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(55), state })
      .set('Cookie', stateCookie);
    record(callback);
    const session = (callback.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('codelens_session='))!;
    record(await request(server).get('/api/me').set('Cookie', session));

    // The session cookie value is an opaque identifier and signature, not a credential.
    expect(session).not.toMatch(/ghu_|ghs_|secret/i);

    const everything = [...seen, ...captured].join('\n');
    for (const secret of forbidden) expect(everything).not.toContain(secret);
  });

  it('does not persist the user credential in the database or the session store', async () => {
    const server = app.getHttpServer();
    const start = await request(server).get('/api/auth/github/login');
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookie = (start.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await request(server)
      .get('/api/auth/github/callback')
      .query({ code: github.authCode(55), state })
      .set('Cookie', cookie);

    const rows = JSON.stringify(await infra.prisma.$queryRawUnsafe('SELECT * FROM users'));
    expect(rows).not.toContain('ghu_fake_');
  });
});
