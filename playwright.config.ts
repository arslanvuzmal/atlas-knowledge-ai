import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const AUTH_DIR = path.join(__dirname, 'tests', 'e2e', '.auth');

/**
 * End-to-end configuration.
 *
 * Tests run against a production build rather than the dev server, so what is
 * verified is what would actually be deployed.
 *
 * A `setup` project authenticates each demo role once and saves its session.
 * Every other project depends on it and reuses those cookies, which keeps the
 * suite from tripping the login rate limiter.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth-setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'public',
      testMatch: /public\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'desktop',
      testMatch: /journey\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: path.join(AUTH_DIR, 'admin.json'),
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        storageState: path.join(AUTH_DIR, 'admin.json'),
      },
    },
    {
      name: 'money-demo',
      testMatch: /money-demo\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
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
