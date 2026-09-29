import { defineConfig } from '@playwright/test';

/**
 * End-to-end run against the whole product with a fake GitHub (spec SC-001, SC-011). The stack is
 * started by tests/e2e/global-setup.ts. It uses the Google Chrome installed on the machine so no
 * browser download is needed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { channel: 'chrome', headless: true, trace: 'off' },
});
