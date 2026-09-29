import { INestApplication } from '@nestjs/common';
import { FakeGithub, FakeRepo } from '../fakes/fake-github';
import { Infra, startApi, startAppWorker, startInfra } from './harness';
import { resetData } from './support';

export interface World {
  infra: Infra;
  github: FakeGithub;
  app: INestApplication;
  worker: { stop(): Promise<void> } | null;
  startWorker(): void;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

/** Containers + fake GitHub + API (+ optionally the queue worker), shared by a test file. */
export async function startWorld(): Promise<World> {
  const infra = await startInfra();
  const github = await new FakeGithub().start();
  const app = await startApi(infra, github);
  const world: World = {
    infra,
    github,
    app,
    worker: null,
    startWorker() {
      if (!world.worker) world.worker = startAppWorker(app, infra);
    },
    async reset() {
      await resetData(infra);
      github.installations.clear();
      github.users.clear();
      github.userAccess.clear();
      github.orgRoles.clear();
      github.clearFailures();
      github.requests = [];
      github.appPermissions = { metadata: 'read' };
    },
    async stop() {
      await world.worker?.stop();
      await app.close();
      await github.stop();
      await infra.stop();
    },
  };
  return world;
}

export function makeRepos(count: number, owner = 'acme', firstId = 9000): FakeRepo[] {
  return Array.from({ length: count }, (_, i) => ({ id: firstId + i, name: `repo-${String(i + 1).padStart(4, '0')}`, owner }));
}

/** An organization installation with `repos` repositories that the given users can access. */
export function seedInstallation(
  github: FakeGithub,
  options: { installationId?: number; accountId?: number; login?: string; repos?: FakeRepo[]; users?: number[]; selection?: 'all' | 'selected'; type?: 'Organization' | 'User' } = {},
) {
  const installationId = options.installationId ?? 500;
  const login = options.login ?? 'acme';
  for (const userId of options.users ?? []) {
    if (!github.users.has(userId)) github.addUser({ id: userId, login: `user-${userId}` });
  }
  github.addInstallation(
    {
      id: installationId,
      account: { id: options.accountId ?? 1000, login, type: options.type ?? 'Organization' },
      selection: options.selection ?? 'selected',
      repos: options.repos ?? makeRepos(3, login),
    },
    options.users ?? [],
  );
  return installationId;
}
