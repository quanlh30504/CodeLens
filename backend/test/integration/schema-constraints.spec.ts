import { Infra, startInfra } from './harness';

/**
 * Asserts the constraints from docs/architecture/database-erd.md (baseline + Amendment 1)
 * reject invalid data. Covers FR-013, FR-029 and the data-model rules.
 */
describe('schema constraints', () => {
  let infra: Infra;

  beforeAll(async () => {
    infra = await startInfra({ redis: false });
  });

  afterAll(async () => {
    await infra.stop();
  });

  const run = (sql: string, ...params: unknown[]) => infra.prisma.$executeRawUnsafe(sql, ...params);

  async function seedOrg(githubOrgId: string, accountType = 'ORGANIZATION') {
    const rows = await infra.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO organizations (github_org_id, account_type, login, updated_at)
       VALUES ($1, $2, $3, now()) RETURNING id`,
      githubOrgId,
      accountType,
      `org-${githubOrgId}`,
    );
    return rows[0].id;
  }

  async function seedInstallation(orgId: string, githubInstallationId: number) {
    const rows = await infra.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO github_installations
         (organization_id, github_installation_id, account_type, account_login, status, installed_at, updated_at)
       VALUES ($1::uuid, $2, 'ORGANIZATION', 'acme', 'ACTIVE', now(), now()) RETURNING id`,
      orgId,
      githubInstallationId,
    );
    return rows[0].id;
  }

  const insertRepo = (orgId: string, installationId: string, githubRepoId: number, fullName: string, extra = {}) => {
    const cols = { status: 'ACCESSIBLE', review_enabled: false, ...extra } as Record<string, unknown>;
    return run(
      `INSERT INTO repositories
        (organization_id, installation_id, github_repository_id, owner, name, full_name, status, review_enabled, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, 'acme', 'r', $4, $5, $6, now())`,
      orgId,
      installationId,
      githubRepoId,
      fullName,
      cols.status,
      cols.review_enabled,
    );
  };

  it('keeps GitHub identifiers unique', async () => {
    await run(`INSERT INTO users (github_user_id, login, updated_at) VALUES ('1', 'a', now())`);
    await expect(run(`INSERT INTO users (github_user_id, login, updated_at) VALUES ('1', 'b', now())`)).rejects.toThrow();

    const org = await seedOrg('100');
    await expect(seedOrg('100')).rejects.toThrow();

    const inst = await seedInstallation(org, 500);
    await expect(seedInstallation(org, 500)).rejects.toThrow();

    await insertRepo(org, inst, 900, 'acme/one');
    await expect(insertRepo(org, inst, 900, 'acme/two')).rejects.toThrow();
    await expect(insertRepo(org, inst, 901, 'acme/one')).rejects.toThrow();
  });

  it('rejects an inaccessible repository that is enabled for review', async () => {
    const org = await seedOrg('101');
    const inst = await seedInstallation(org, 501);
    await expect(
      insertRepo(org, inst, 910, 'acme/bad', { status: 'INACCESSIBLE', review_enabled: true }),
    ).rejects.toThrow(/review_enabled_requires_accessible/);
    await insertRepo(org, inst, 911, 'acme/ok', { status: 'INACCESSIBLE', review_enabled: false });
    await insertRepo(org, inst, 912, 'acme/enabled', { status: 'ACCESSIBLE', review_enabled: true });
  });

  it.each([
    ['organizations.account_type', `UPDATE organizations SET account_type = 'TEAM'`],
    ['organization_members.role', `UPDATE organization_members SET role = 'ADMIN'`],
    ['github_installations.status', `UPDATE github_installations SET status = 'PAUSED'`],
    ['github_installations.sync_status', `UPDATE github_installations SET sync_status = 'DONE'`],
    ['github_installations.repository_selection', `UPDATE github_installations SET repository_selection = 'SOME'`],
    ['repositories.status', `UPDATE repositories SET status = 'GONE'`],
  ])('rejects invalid values for %s', async (_name, sql) => {
    const org = await seedOrg(`v-${_name}`);
    const inst = await seedInstallation(org, Math.floor(Math.random() * 1e9) + 1000);
    await insertRepo(org, inst, Math.floor(Math.random() * 1e9) + 1e10, `acme/${_name}`);
    const user = await infra.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO users (github_user_id, login, updated_at) VALUES ($1, 'u', now()) RETURNING id`,
      `u-${_name}`,
    );
    await run(
      `INSERT INTO organization_members (organization_id, user_id, role, updated_at) VALUES ($1::uuid, $2::uuid, 'MEMBER', now())`,
      org,
      user[0].id,
    );
    await expect(run(sql)).rejects.toThrow();
  });

  it('allows one membership per user and organization', async () => {
    const org = await seedOrg('102');
    const user = await infra.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO users (github_user_id, login, updated_at) VALUES ('m1', 'm', now()) RETURNING id`,
    );
    const insert = () =>
      run(
        `INSERT INTO organization_members (organization_id, user_id, role, updated_at) VALUES ($1::uuid, $2::uuid, 'MEMBER', now())`,
        org,
        user[0].id,
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('keeps webhook delivery identifiers unique and status values valid', async () => {
    const insert = (guid: string, status = 'RECEIVED') =>
      run(
        `INSERT INTO webhook_deliveries (delivery_guid, event, payload_sha256, status) VALUES ($1, 'installation', 'abc', $2)`,
        guid,
        status,
      );
    await insert('d-1');
    await expect(insert('d-1')).rejects.toThrow();
    await expect(insert('d-2', 'DONE')).rejects.toThrow();
  });

  it('requires foreign keys to reference existing rows', async () => {
    await expect(
      run(
        `INSERT INTO github_installations
           (organization_id, github_installation_id, account_type, account_login, status, installed_at, updated_at)
         VALUES (gen_random_uuid(), 9999, 'ORGANIZATION', 'x', 'ACTIVE', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it('has the indexes required by the ERD', async () => {
    const rows = await infra.prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.indexname);
    for (const expected of [
      'repositories_installation_id_status_idx',
      'webhook_deliveries_github_installation_id_received_at_idx',
      'audit_logs_organization_id_created_at_idx',
      'repositories_organization_id_idx',
    ]) {
      expect(names).toContain(expected);
    }
  });
});
