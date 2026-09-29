/**
 * Which work an authentic event asks for (contracts/webhooks.md). Handlers never copy state from
 * the payload: they only use the installation id to look at GitHub again (spec FR-030).
 */
export type Routing =
  | { kind: 'reconcile'; githubInstallationId: number }
  | { kind: 'sync'; githubInstallationId: number }
  | { kind: 'ignore'; reason: string };

const RECONCILE_ACTIONS = new Set(['created', 'deleted', 'suspend', 'unsuspend', 'new_permissions_accepted']);
const SYNC_REPOSITORY_ACTIONS = new Set(['renamed', 'transferred', 'publicized', 'privatized', 'deleted']);

export function installationIdOf(payload: unknown): number | null {
  const id = (payload as { installation?: { id?: unknown } } | null)?.installation?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function actionOf(payload: unknown): string | null {
  const action = (payload as { action?: unknown } | null)?.action;
  return typeof action === 'string' && action.length <= 64 ? action : null;
}

export function routeEvent(event: string, payload: unknown): Routing {
  const installationId = installationIdOf(payload);
  const action = actionOf(payload);

  if (event === 'installation') {
    if (installationId === null) return { kind: 'ignore', reason: 'NO_INSTALLATION' };
    return action && RECONCILE_ACTIONS.has(action)
      ? { kind: 'reconcile', githubInstallationId: installationId }
      : { kind: 'ignore', reason: 'UNHANDLED_ACTION' };
  }
  if (event === 'installation_repositories') {
    if (installationId === null) return { kind: 'ignore', reason: 'NO_INSTALLATION' };
    return action === 'added' || action === 'removed'
      ? { kind: 'sync', githubInstallationId: installationId }
      : { kind: 'ignore', reason: 'UNHANDLED_ACTION' };
  }
  if (event === 'repository') {
    if (installationId === null) return { kind: 'ignore', reason: 'NO_INSTALLATION' };
    return action && SYNC_REPOSITORY_ACTIONS.has(action)
      ? { kind: 'sync', githubInstallationId: installationId }
      : { kind: 'ignore', reason: 'UNHANDLED_ACTION' };
  }
  return { kind: 'ignore', reason: 'UNHANDLED_EVENT' };
}
