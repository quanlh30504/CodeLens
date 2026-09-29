import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { FakeGithub } from '../fakes/fake-github';
import type { Infra } from './harness';

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

export async function resetData(infra: Infra): Promise<void> {
  await infra.prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, repositories, github_installations, organization_members, organizations, users, webhook_deliveries RESTART IDENTITY CASCADE',
  );
}
