import { expect, test, type Page } from '@playwright/test';

/**
 * Mobile layout checks.
 *
 * The central assertion is that the page body never scrolls horizontally. Wide
 * content — tables, charts — must scroll inside its own container instead,
 * which is the rule the design system sets and the easiest one to break.
 */

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  // One pixel of tolerance for sub-pixel rounding.
  expect(overflow.scroll, `${label} scrolls horizontally`).toBeLessThanOrEqual(overflow.client + 1);
}

test.describe('mobile layout', () => {
  test('landing page fits the viewport', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await assertNoHorizontalOverflow(page, 'landing page');
  });

  test('public demo is usable and fits the viewport', async ({ page }) => {
    await page.goto('/demo');

    const input = page.getByLabel('Ask a question');
    await expect(input).toBeVisible();
    await input.fill('What is the refund policy?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    await expect(page.locator('article').last()).toBeVisible({ timeout: 45_000 });
    await assertNoHorizontalOverflow(page, 'public demo');
  });

  test('dashboard navigation opens and closes as an overlay', async ({ page }) => {
    await page.goto('/dashboard');

    // The sidebar is collapsed at this width and reached through the toggle.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Close navigation' }).click();
    await assertNoHorizontalOverflow(page, 'dashboard overview');
  });

  test('wide tables scroll inside their own container', async ({ page }) => {
    await page.goto('/dashboard/documents');
    await expect(page.getByRole('table')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'documents table');
  });

  test('analytics charts fit the viewport', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await expect(page.getByText('Questions asked').first()).toBeVisible();
    await assertNoHorizontalOverflow(page, 'analytics');
  });

  test('chat is usable on a small screen', async ({ page }) => {
    await page.goto('/chat');

    await page.getByLabel('Ask a question').fill('What is the free trial length?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    await expect(page.locator('article').last()).toBeVisible({ timeout: 45_000 });
    await assertNoHorizontalOverflow(page, 'chat');
  });
});
