import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Reproducible portfolio screenshots.
 *
 * Every image is captured from the running application against the seeded
 * fictional corpus, so nothing here is a mockup. Re-running this file
 * regenerates the whole set.
 */

const OUT = path.join(__dirname, '..', '..', 'docs', 'assets', 'screenshots');

async function shot(page: Page, name: string, fullPage = false) {
  // Let fonts settle so text is never captured mid-swap.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

async function ask(page: Page, question: string) {
  const before = await page.locator('article').count();
  await page.getByLabel('Ask a question').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(before + 1, { timeout: 45_000 });
  return page.locator('article').last();
}

test.describe('portfolio capture', () => {
  test('01 landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, '01-landing');
  });

  test('02 analytics dashboard', async ({ page }) => {
    await page.goto('/dashboard/analytics');
    await expect(page.getByRole('heading', { name: 'Answer grounding' })).toBeVisible();
    await shot(page, '02-analytics');
  });

  test('03 dashboard overview', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Question volume' })).toBeVisible();
    await shot(page, '03-overview');
  });

  test('04 document library', async ({ page }) => {
    await page.goto('/dashboard/documents');
    await expect(page.getByRole('table')).toBeVisible();
    await shot(page, '04-documents');
  });

  test('05 document detail and processing state', async ({ page }) => {
    await page.goto('/dashboard/documents');
    await page.getByRole('link', { name: /Refund and Cancellation Policy/ }).click();
    await expect(page.getByRole('heading', { name: 'Metadata' })).toBeVisible();
    await shot(page, '05-document-detail');
  });

  test('06 chat answer with citations', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'What is the refund window for an annual subscription?');
    await expect(answer.getByText('Sources')).toBeVisible();
    await shot(page, '06-chat-citations');
  });

  test('07 source drawer', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'How much does the Team plan cost per user?');
    await answer.getByRole('button').filter({ hasText: 'Pricing' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, '07-source-drawer');
  });

  test('09 escalation queue', async ({ page }) => {
    await page.goto('/dashboard/escalations');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, '09-escalations');
  });

  test('10 retrieval settings', async ({ page }) => {
    await page.goto('/dashboard/retrieval');
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await shot(page, '10-retrieval-settings');
  });

  test('11 users and access ladder', async ({ page }) => {
    await page.goto('/dashboard/users');
    await expect(page.getByRole('heading', { name: 'Access ladder' })).toBeVisible();
    await shot(page, '11-users-access');
  });

  test('12 system health', async ({ page }) => {
    await page.goto('/dashboard/health');
    await expect(page.getByRole('heading', { name: 'PostgreSQL database' })).toBeVisible();
    await shot(page, '12-system-health');
  });

  test('13 add sources', async ({ page }) => {
    await page.goto('/dashboard/upload');
    await expect(page.getByRole('tab', { name: 'Upload a file' })).toBeVisible();
    await shot(page, '13-add-sources');
  });

  test('14 audit log', async ({ page }) => {
    await page.goto('/dashboard/audit');
    await expect(page.getByRole('table')).toBeVisible();
    await shot(page, '14-audit-log');
  });
});

/**
 * Captured with no session at all.
 *
 * The refusal only happens for a caller who genuinely lacks the access level —
 * an administrator would (correctly) be shown the handbook — so this must run
 * as an anonymous visitor to be an honest screenshot.
 */
test.describe('anonymous capture', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('08 access control refusal', async ({ page }) => {
    await page.goto('/demo');
    const answer = await ask(page, 'How many days of annual leave do employees receive?');
    await expect(answer).toContainText(/could not find enough approved information/i);
    await shot(page, '08-access-refusal');
  });
});

test.describe('mobile capture', () => {
  test.use({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true });

  test('15 mobile chat', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'What is the refund window for an annual subscription?');
    await expect(answer.getByText('Sources')).toBeVisible();
    await shot(page, '15-mobile-chat', true);
  });

  test('16 mobile dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, '16-mobile-dashboard');
  });
});
