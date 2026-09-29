import { ALLOWED_PERMISSIONS } from './allowed-permissions';

export class PermissionCheckError extends Error {}

/**
 * Refuses to start if the registered app holds any permission that is not read-only or not on
 * the allow-list (spec SC-014). The error names the offending permission, never a secret.
 */
export function assertReadOnlyPermissions(
  granted: Record<string, string>,
  allowed: Readonly<Record<string, string>> = ALLOWED_PERMISSIONS,
): void {
  const problems: string[] = [];
  for (const [permission, level] of Object.entries(granted)) {
    if (level !== 'read') {
      problems.push(`${permission}:${level} (only read access is allowed)`);
    } else if (allowed[permission] !== 'read') {
      problems.push(`${permission}:${level} (not in the allow-list)`);
    }
  }
  if (problems.length > 0) {
    throw new PermissionCheckError(`GitHub App has disallowed permissions: ${problems.join(', ')}`);
  }
}

export interface AppPermissionSource {
  getApp(): Promise<{ permissions: Record<string, string> }>;
}

export async function checkAppPermissionsAtStartup(source: AppPermissionSource): Promise<void> {
  const app = await source.getApp();
  assertReadOnlyPermissions(app.permissions);
}
