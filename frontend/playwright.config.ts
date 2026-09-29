import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.CODELENS_E2E_BASE_URL ?? 'http://localhost:8080' },
});
