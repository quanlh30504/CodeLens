import { describe, expect, it } from 'vitest';
import type { Installation } from './installation-states';
import { filterByOrganization, selectableOrganization } from './organizations';

const installation = (id: string, organizationId: string) =>
  ({ id, organization: { id: organizationId, login: organizationId, accountType: 'ORGANIZATION' } }) as Installation;

describe('organizations', () => {
  const all = [installation('i1', 'acme'), installation('i2', 'globex'), installation('i3', 'acme')];

  it('shows everything the caller may see when no organization is selected', () => {
    expect(filterByOrganization(all, undefined)).toHaveLength(3);
  });

  it('shows only the selected organization', () => {
    expect(filterByOrganization(all, 'acme').map((i) => i.id)).toEqual(['i1', 'i3']);
  });

  it('ignores a requested organization the caller does not belong to', () => {
    const mine = [{ id: 'acme' }, { id: 'globex' }];
    expect(selectableOrganization(mine, 'acme')).toBe('acme');
    expect(selectableOrganization(mine, 'someone-elses')).toBeUndefined();
    expect(selectableOrganization(mine, ['acme'])).toBeUndefined();
    expect(selectableOrganization(mine, undefined)).toBeUndefined();
  });
});
