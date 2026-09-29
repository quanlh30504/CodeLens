import { createHmac, randomUUID } from 'node:crypto';

/** Test-only secret; never a real value. */
export const TEST_WEBHOOK_SECRET = 'test-only-webhook-secret-0123456789';

export interface SignedWebhook {
  headers: Record<string, string>;
  body: string;
}

export function sign(body: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function signedWebhook(
  event: string,
  payload: Record<string, unknown>,
  options: { deliveryId?: string; secret?: string } = {},
): SignedWebhook {
  const body = JSON.stringify(payload);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': options.deliveryId ?? randomUUID(),
      'x-hub-signature-256': sign(body, options.secret),
    },
  };
}

const account = (id: number, login: string, type: 'Organization' | 'User' = 'Organization') => ({
  id,
  login,
  type,
});

export const fixtures = {
  installationCreated: (installationId: number, accountId = 1000, login = 'acme', deliveryId?: string) =>
    signedWebhook(
      'installation',
      {
        action: 'created',
        installation: { id: installationId, account: account(accountId, login) },
        sender: { id: 1, login: 'octo' },
      },
      { deliveryId },
    ),
  installationDeleted: (installationId: number, accountId = 1000, login = 'acme') =>
    signedWebhook('installation', {
      action: 'deleted',
      installation: { id: installationId, account: account(accountId, login) },
      sender: { id: 1, login: 'octo' },
    }),
  installationSuspended: (installationId: number, accountId = 1000, login = 'acme') =>
    signedWebhook('installation', {
      action: 'suspend',
      installation: { id: installationId, account: account(accountId, login) },
      sender: { id: 1, login: 'octo' },
    }),
  installationUnsuspended: (installationId: number, accountId = 1000, login = 'acme') =>
    signedWebhook('installation', {
      action: 'unsuspend',
      installation: { id: installationId, account: account(accountId, login) },
      sender: { id: 1, login: 'octo' },
    }),
  installationRepositoriesAdded: (installationId: number) =>
    signedWebhook('installation_repositories', {
      action: 'added',
      installation: { id: installationId },
      repositories_added: [{ id: 5001, name: 'added' }],
    }),
  installationRepositoriesRemoved: (installationId: number) =>
    signedWebhook('installation_repositories', {
      action: 'removed',
      installation: { id: installationId },
      repositories_removed: [{ id: 5001, name: 'removed' }],
    }),
  repository: (installationId: number, action: 'renamed' | 'transferred' | 'publicized' | 'privatized' | 'deleted') =>
    signedWebhook('repository', {
      action,
      installation: { id: installationId },
      repository: { id: 5001, name: 'repo' },
    }),
  ping: () => signedWebhook('ping', { zen: 'Keep it logically awesome.' }),
};
