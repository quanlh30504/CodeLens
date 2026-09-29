import { ALLOWED_PERMISSIONS } from '../../src/github/allowed-permissions';
import { GithubAppClient } from '../../src/github/github-app.client';
import { GithubError } from '../../src/github/github-errors';
import { PermissionCheckError, checkAppPermissionsAtStartup } from '../../src/github/permission-check';
import { FakeGithub } from '../fakes/fake-github';

describe('startup permission check (SC-014)', () => {
  let github: FakeGithub;
  let client: GithubAppClient;

  beforeAll(async () => {
    github = await new FakeGithub().start();
    client = new GithubAppClient({
      appId: github.appId,
      apiBaseUrl: github.url,
      privateKey: () => github.privateKeyPem,
    });
  });

  afterAll(async () => {
    await github.stop();
  });

  beforeEach(() => {
    github.appPermissions = { metadata: 'read' };
    github.clearFailures();
  });

  it('starts with the read-only allowed set (also proves the App JWT is signed correctly)', async () => {
    await expect(checkAppPermissionsAtStartup(client)).resolves.toBeUndefined();
  });

  it.each([
    [{ metadata: 'read', contents: 'write' }, /contents:write/],
    [{ metadata: 'read', pull_requests: 'write' }, /pull_requests:write/],
    [{ metadata: 'read', administration: 'admin' }, /administration:admin/],
  ])('stops startup for a write or admin permission %j', async (permissions, message) => {
    github.appPermissions = permissions;
    await expect(checkAppPermissionsAtStartup(client)).rejects.toThrow(PermissionCheckError);
    await expect(checkAppPermissionsAtStartup(client)).rejects.toThrow(message);
  });

  it('stops startup for a read permission that is not in the allow-list', async () => {
    github.appPermissions = { metadata: 'read', contents: 'read' };
    await expect(checkAppPermissionsAtStartup(client)).rejects.toThrow(/contents:read \(not in the allow-list\)/);
  });

  it('never puts a secret in the error message', async () => {
    github.appPermissions = { metadata: 'read', contents: 'write' };
    const error = await checkAppPermissionsAtStartup(client).catch((e: Error) => e);
    expect((error as Error).message).not.toContain('PRIVATE KEY');
  });

  it('keeps the allow-list free of write and admin entries', () => {
    for (const level of Object.values(ALLOWED_PERMISSIONS)) expect(level).toBe('read');
  });

  it('reports GitHub being unreachable as a categorized error without upstream text', async () => {
    github.forceDown = true;
    const error = await client.getApp().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubError);
    expect((error as GithubError).code).toBe('GITHUB_UNAVAILABLE');
    expect((error as GithubError).message).not.toContain('down');
  });
});
