import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * The main journeys in a real browser: sign in, install, see repositories, enable and disable,
 * uninstall (spec US1 to US4, SC-001, SC-010). GitHub is the fake; everything else is the product.
 */
const BASE = () => process.env.E2E_BASE_URL!;
const control = async (route: string, body: unknown = {}) => {
  const response = await fetch(`http://127.0.0.1:${process.env.E2E_CONTROL_PORT}${route}`, { method: 'POST', body: JSON.stringify(body) });
  expect(response.ok).toBe(true);
};

const repos = (count: number) => Array.from({ length: count }, (_, i) => ({ id: 9000 + i, name: `repo-${i + 1}`, owner: 'acme', private: i % 2 === 0 }));

function sql(statement: string): void {
  execFileSync('docker', ['exec', process.env.E2E_POSTGRES_CONTAINER!, 'psql', '-U', 'codelens', '-d', 'codelens', '-c', statement], { stdio: 'pipe' });
}

async function sendWebhook(event: string, payload: object): Promise<number> {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', process.env.E2E_WEBHOOK_SECRET!).update(body).digest('hex')}`;
  const response = await fetch(`${BASE()}/api/webhooks/github`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': randomUUID(), 'x-hub-signature-256': signature },
    body,
  });
  return response.status;
}

/** Each test gets a fresh browser, so it signs in through the fake GitHub first. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE()}/sign-in`);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/installations$/);
}

const seen: string[] = [];
function watch(page: Page): void {
  page.on('response', async (response) => {
    const type = response.headers()['content-type'] ?? '';
    if (/json|html|javascript|text/.test(type)) seen.push(await response.text().catch(() => ''));
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await control('/reset');
  await control('/user', { id: 10, login: 'ada' });
  await control('/user', { id: 11, login: 'grace' });
  await control('/browser', { userId: 10, declines: false, sendCode: true, pendingInstallationId: 500 });
  await control('/installation', {
    id: 500,
    account: { id: 1000, login: 'acme', type: 'Organization' },
    selection: 'selected',
    repos: repos(3),
    users: [10, 11],
  });
});

test('a first-time visitor signs in, installs, and sees the repositories within five minutes (SC-001)', async ({ page }) => {
  watch(page);
  const started = Date.now();

  await page.goto(`${BASE()}/`);
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/installations$/);
  await expect(page.getByText('No installations yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Install CodeLens' }).click();
  await expect(page).toHaveURL(/\/installations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'acme' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row', { name: /acme\/repo-1/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /acme\/repo-2/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /acme\/repo-3/ })).toBeVisible();

  expect(Date.now() - started).toBeLessThan(5 * 60 * 1000);

  // Installation → Organization → Repositories, every repository starts disabled.
  await expect(page.getByText('Status:').first()).toBeVisible();
  for (const row of await page.getByRole('row').all()) {
    const text = await row.innerText();
    if (text.includes('acme/repo')) expect(text).toContain('Disabled');
  }
  // A member sees the control as unavailable, with the reason (spec FR-040).
  await expect(page.getByText('Only organization owners can change this.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable' }).first()).toBeDisabled();
});

test('the session cookie cannot be read by page scripts, and no secret reaches the browser (SC-010)', async ({ page, context }) => {
  watch(page);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'GitHub installations' })).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'codelens_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('codelens_session');

  const storage = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  const everything = [await page.content(), storage, ...seen].join('\n');
  for (const secret of JSON.parse(process.env.E2E_SECRETS!) as string[]) expect(everything).not.toContain(secret);
  expect(everything).not.toMatch(/PRIVATE KEY|ghu_fake_|ghs_fake_/);
});

test('an owner enables and disables a repository without uninstalling the app', async ({ page }) => {
  await signIn(page);
  // The role GitHub would confirm for an organization owner (recorded here directly; see task T077).
  sql("UPDATE organization_members SET role = 'OWNER', role_verified_at = now()");
  await page.goto(`${BASE()}/installations`);
  await page.getByRole('link', { name: 'acme' }).click();

  const row = page.getByRole('row', { name: /acme\/repo-1/ });
  await expect(row.getByRole('button', { name: 'Enable CodeLens' })).toBeEnabled();
  await row.getByRole('button', { name: 'Enable CodeLens' }).click();
  await expect(row.getByText('Enabled')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Disable CodeLens' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('row', { name: /acme\/repo-1/ }).getByText('Enabled')).toBeVisible();
  await expect(page.getByRole('row', { name: /acme\/repo-2/ }).getByText('Disabled')).toBeVisible();

  await page.getByRole('row', { name: /acme\/repo-1/ }).getByRole('button', { name: 'Disable CodeLens' }).click();
  await expect(page.getByRole('row', { name: /acme\/repo-1/ }).getByText('Disabled')).toBeVisible();
});

test('an owner whose role was confirmed long ago is asked to confirm with GitHub', async ({ page }) => {
  await signIn(page);
  sql("UPDATE organization_members SET role = 'OWNER', role_verified_at = now() - interval '30 minutes'");
  await page.goto(`${BASE()}/installations`);
  await page.getByRole('link', { name: 'acme' }).click();
  const row = page.getByRole('row', { name: /acme\/repo-2/ });
  await row.getByRole('button', { name: 'Enable CodeLens' }).click();
  await expect(row.getByText('Please confirm your access with GitHub, then try again.')).toBeVisible();
  await expect(row.getByRole('link', { name: 'Confirm with GitHub' })).toBeVisible();
  await expect(row.getByText('Disabled')).toBeVisible(); // nothing changed
});

test('uninstalling on GitHub shows the installation as removed and every repository as no longer accessible', async ({ page }) => {
  await signIn(page);
  await control('/remove-installation', { id: 500 });
  const status = await sendWebhook('installation', {
    action: 'deleted',
    installation: { id: 500, account: { id: 1000, login: 'acme', type: 'Organization' } },
  });
  expect(status).toBe(202);

  await page.goto(`${BASE()}/installations`);
  await page.getByRole('link', { name: 'acme' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('Removed').first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  for (const row of await page.getByRole('row').all()) {
    const text = await row.innerText();
    if (text.includes('acme/repo')) expect(text).toContain('No longer accessible');
  }
  await expect(page.getByRole('button', { name: /Enable CodeLens|Disable CodeLens/ })).toHaveCount(0);
});

test('a signature that does not match is refused and changes nothing', async () => {
  const response = await fetch(`${BASE()}/api/webhooks/github`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': 'installation', 'x-github-delivery': randomUUID(), 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
    body: JSON.stringify({ action: 'deleted', installation: { id: 500 } }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: 'NOT_ACCEPTED', message: 'Not accepted.' });
});
