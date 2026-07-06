import { defineConfig, devices } from '@playwright/test';

const previewUrl = 'http://127.0.0.1:4173/patch-lab-practice/';
const externalPreview = process.env.PATCHLAB_EXTERNAL_PREVIEW === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: /(corpus|worklets)\.spec\.ts/,
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  ...(externalPreview
    ? {}
    : {
        webServer: {
          command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173',
          url: previewUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
        },
      }),
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
