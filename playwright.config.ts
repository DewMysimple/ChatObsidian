import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', viewport: { width: 1280, height: 760 } },
  webServer: {
    command: 'corepack pnpm dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
  },
});
