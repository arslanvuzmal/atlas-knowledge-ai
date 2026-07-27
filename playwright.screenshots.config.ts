import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const AUTH_DIR = path.join(__dirname, 'tests', 'e2e', '.auth');

/**
 * Portfolio screenshot capture.
 *
 * Kept separate from the test configuration so `npm run portfolio:capture`
 * never runs assertions that could fail a CI gate, and so the capture viewport
 * stays fixed at a consistent size across runs.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(auth-setup|screenshots\.capture)\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // A fixed device scale factor keeps every image crisp and identically sized.
    deviceScaleFactor: 2,
  },

  projects: [
    { name: 'setup', testMatch: /auth-setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'capture',
      testMatch: /screenshots\.capture\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: path.join(AUTH_DIR, 'admin.json'),
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
