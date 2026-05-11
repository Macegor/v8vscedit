import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
});
