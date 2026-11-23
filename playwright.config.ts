import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.e2e.ts', // not *.spec.ts / *.test.ts, so vitest never picks these up
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Locally you can reuse installed Chrome: PW_CHANNEL=chrome npm run test:browser
    channel: process.env.PW_CHANNEL || undefined,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node tests/browser/serve.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
