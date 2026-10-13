import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-artifacts/playwright.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run build:bare && npx vite preview --mode bare --port 4174 --strictPort',
      port: 4174,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'npm run build:e2e && npx vite preview --mode e2e --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'bare',
      testMatch: /bare\/.*\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium' },
    },
    {
      name: 'harness',
      testMatch: /harness\/.*\.spec\.ts/,
      use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
    },
  ],
});
