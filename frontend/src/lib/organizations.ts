import type { Installation } from './installation-states';

/** Installations of the selected organization, or all of the caller's when none is selected. */
export function filterByOrganization(installations: Installation[], organizationId: string | undefined): Installation[] {
  if (!organizationId) return installations;
  return installations.filter((installation) => installation.organization.id === organizationId);
}

/** Only an organization the API listed for the caller can be selected; anything else is ignored. */
export function selectableOrganization(
  organizations: { id: string }[],
  requested: string | string[] | undefined,
): string | undefined {
  return typeof requested === 'string' && organizations.some((organization) => organization.id === requested)
    ? requested
    : undefined;
}
