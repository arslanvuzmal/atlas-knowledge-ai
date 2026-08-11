import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Authenticates each demo role once and saves the session cookie.
 *
 * Signing in inside every test would trip the login rate limiter — eight
 * failures or ten attempts in fifteen minutes from one address — which is
 * correct product behaviour but makes a test suite impossible. Reusing a saved
 * session is both faster and closer to how a real user behaves.
 */

const DEMO_PASSWORD = 'AtlasDemo!2026';

export const STORAGE = {
  admin: path.join(__dirname, '.auth', 'admin.json'),
  manager: path.join(__dirname, '.auth', 'manager.json'),
  employee: path.join(__dirname, '.auth', 'employee.json'),
  customer: path.join(__dirname, '.auth', 'customer.json'),
};

const ACCOUNTS: [keyof typeof STORAGE, string][] = [
  ['admin', 'admin@atlasknowledge.demo'],
  ['manager', 'manager@atlasknowledge.demo'],
  ['employee', 'employee@atlasknowledge.demo'],
  ['customer', 'customer@atlasknowledge.demo'],
];

for (const [role, email] of ACCOUNTS) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL('**/dashboard', { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');

    await page.context().storageState({ path: STORAGE[role] });
  });
}
