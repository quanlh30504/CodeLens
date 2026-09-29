/** @type {import('jest').Config} */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/setup-env.js'],
};

module.exports = {
  // Integration tests start containers in beforeAll; unit and contract tests finish in milliseconds.
  testTimeout: 120000,
  // Every suite closes what it opens (checked with --detectOpenHandles, which reports none), but a
  // shared client library keeps the process alive after the last suite when they all run in one
  // process. Exiting after the results are in stops CI from hanging; the containers are removed
  // by the test container library's own cleanup.
  forceExit: true,
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'contract', testMatch: ['<rootDir>/test/contract/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
  ],
};
