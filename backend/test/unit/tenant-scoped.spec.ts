import { NotFoundException } from '@nestjs/common';
import { SystemContext } from '../../src/queue/system-context';
import { InstallationsRepository, requireUuid } from '../../src/installations/installations.repository';
import { systemScope, userScope } from '../../src/tenancy/tenant-scoped.repository';
import type { PrismaService } from '../../src/tenancy/prisma.service';

describe('tenant-scoped access needs a scope (FR-009)', () => {
  // A repository that would fail loudly if it ever reached the database without a scope.
  const prisma = {
    githubInstallation: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
    repository: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const repository = new InstallationsRepository(prisma);

  it('cannot be called without a scope (compile time)', () => {
    // @ts-expect-error a scope is required
    void repository.list().catch(() => undefined);
    // @ts-expect-error a scope is required
    void repository.get(undefined, 'x').catch(() => undefined);
  });

  it('cannot be called with a scope-less argument at run time', async () => {
    await expect(repository.list(undefined as never)).rejects.toThrow(/tenant scope is required/);
    await expect(repository.get(undefined as never, '00000000-0000-4000-8000-000000000000')).rejects.toThrow();
  });

  it('restricts a user scope to the caller organizations and a system scope to exactly one', async () => {
    await repository.list(userScope({ userId: 'u', memberships: [{ organizationId: 'org-1', role: 'MEMBER', roleVerifiedAt: null }] }));
    expect(prisma.githubInstallation.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { organizationId: { in: ['org-1'] } } }),
    );
    await repository.list(systemScope('org-9'));
    expect(prisma.githubInstallation.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { organizationId: { in: ['org-9'] } } }),
    );
  });

  it('a user with no memberships is scoped to nothing rather than to everything', async () => {
    await repository.list(userScope({ userId: 'u', memberships: [] }));
    expect(prisma.githubInstallation.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { organizationId: { in: [] } } }),
    );
  });

  it('treats an id that is not a UUID as not found', () => {
    expect(() => requireUuid('not-a-uuid')).toThrow(NotFoundException);
    expect(requireUuid('00000000-0000-4000-8000-000000000000')).toBeDefined();
  });
});

describe('SystemContext', () => {
  const context = SystemContext.forInstallation({ organizationId: 'org-1' });

  it('is bound to the installation\'s organization only', () => {
    expect(context.scope).toEqual({ kind: 'system', organizationId: 'org-1' });
    expect(() => context.assertOwns({ organizationId: 'org-1' })).not.toThrow();
    expect(() => context.assertOwns({ organizationId: 'org-2' })).toThrow(NotFoundException);
    expect(() => context.assertWritesTo('org-2')).toThrow(NotFoundException);
  });
});
