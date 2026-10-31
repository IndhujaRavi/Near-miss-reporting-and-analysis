import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4191',
    viewport: { width: 1440, height: 1050 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: {
    command: 'npm run preview -- --port 4191 --strictPort',
    url: 'http://127.0.0.1:4191', reuseExistingServer: !process.env.CI,
  },
});
