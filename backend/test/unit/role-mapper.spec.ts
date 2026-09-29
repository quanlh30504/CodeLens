import { mapGithubRole } from '../../src/tenancy/role-mapper';

describe('mapGithubRole (spec FR-035)', () => {
  const org = { accountType: 'ORGANIZATION' as const, accountGithubId: '1000', userGithubId: '7' };

  it('makes a GitHub organization owner (admin) an OWNER', () => {
    expect(mapGithubRole({ ...org, membership: { state: 'active', role: 'admin' } })).toBe('OWNER');
  });

  it.each([
    [{ state: 'active', role: 'member' }],
    [{ state: 'active', role: 'billing_manager' }],
    [{ state: 'active', role: 'some-custom-role' }],
    [{ state: 'pending', role: 'admin' }],
    [null],
  ])('makes %j a MEMBER', (membership) => {
    expect(mapGithubRole({ ...org, membership })).toBe('MEMBER');
  });

  it('makes the holder of a personal account its OWNER and everyone else a MEMBER', () => {
    const personal = { accountType: 'USER' as const, accountGithubId: '7', membership: null };
    expect(mapGithubRole({ ...personal, userGithubId: '7' })).toBe('OWNER');
    expect(mapGithubRole({ ...personal, userGithubId: '8' })).toBe('MEMBER');
  });

  it('does not treat repository access alone as ownership', () => {
    expect(mapGithubRole({ ...org, membership: null })).toBe('MEMBER');
  });
});
