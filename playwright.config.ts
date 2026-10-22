import { defineConfig } from '@playwright/test';

/** Browser tests for apply-assist: local fixture forms only, no network. */
export default defineConfig({
  testDir: 'tests/apply',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { browserName: 'chromium', headless: true },
});
