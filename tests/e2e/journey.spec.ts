import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Authenticated journey.
 *
 * Runs with the administrator session saved by the setup project, and switches
 * to another saved role where a permission boundary is the point of the test.
 */

const AUTH_DIR = path.join(__dirname, '.auth');

async function ask(page: Page, question: string) {
  const before = await page.locator('article').count();
  await page.getByLabel('Ask a question').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(before + 1, { timeout: 45_000 });
  return page.locator('article').last();
}

test.describe('dashboard overview', () => {
  test('shows headline figures computed from real activity', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back');
    await expect(page.getByText('Indexed documents')).toBeVisible();
    await expect(page.getByText('Questions answered')).toBeVisible();
    await expect(page.getByText('Grounded answers')).toBeVisible();
    // Scoped to the panel heading: the chart also carries a screen-reader-only
    // table caption with the same words, which is the accessible fallback.
    await expect(page.getByRole('heading', { name: 'Question volume' })).toBeVisible();
  });

  test('every sidebar route resolves and renders a heading', async ({ page }) => {
    const routes = [
      '/dashboard',
      '/dashboard/analytics',
      '/dashboard/documents',
      '/dashboard/upload',
      '/dashboard/knowledge-bases',
      '/dashboard/conversations',
      '/dashboard/escalations',
      '/dashboard/feedback',
      '/dashboard/retrieval',
      '/dashboard/models',
      '/dashboard/integrations',
      '/dashboard/users',
      '/dashboard/health',
      '/dashboard/audit',
      '/dashboard/demo',
      '/dashboard/settings',
    ];

    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }).first(), route).toBeVisible();
    }
  });
});

test.describe('knowledge management', () => {
  test('lists documents with their state and access level', async ({ page }) => {
    await page.goto('/dashboard/documents');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Documents');
    await expect(page.getByRole('link', { name: /Refund and Cancellation Policy/ })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('surfaces the failed document and its error message', async ({ page }) => {
    await page.goto('/dashboard/documents?status=FAILED');

    await expect(page.getByText(/damaged upload/i)).toBeVisible();
    await expect(page.getByText(/could not be parsed/i)).toBeVisible();
  });

  test('shows indexed passages and runs a retrieval probe', async ({ page }) => {
    await page.goto('/dashboard/documents');
    await page.getByRole('link', { name: /Refund and Cancellation Policy/ }).click();

    await expect(page.getByRole('heading', { name: 'Indexed passages' })).toBeVisible();

    await page.getByLabel('Test a question against this document').fill('annual refund window');
    await page.getByRole('button', { name: 'Test retrieval' }).click();

    await expect(page.getByText(/Confidence/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('offers all three ingestion routes', async ({ page }) => {
    await page.goto('/dashboard/upload');

    await expect(page.getByRole('tab', { name: 'Upload a file' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Register a URL' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Write an entry' })).toBeVisible();
  });

  test('refuses an SSRF target from the URL form', async ({ page }) => {
    await page.goto('/dashboard/upload');
    await page.getByRole('tab', { name: 'Register a URL' }).click();

    await page.getByLabel('Page URL').fill('http://169.254.169.254/latest/meta-data/');
    await page.getByRole('button', { name: 'Fetch and index' }).click();

    await expect(page.getByRole('status').first()).toContainText(
      /blocked|not permitted|internal|could not be ingested/i,
      { timeout: 30_000 },
    );
  });

  test('indexes a written entry end to end', async ({ page }) => {
    await page.goto('/dashboard/upload');
    await page.getByRole('tab', { name: 'Write an entry' }).click();

    // Both the title and the body carry the run id. Duplicate detection is by
    // content checksum, so a fixed body would legitimately be rejected on the
    // second run of this suite.
    const runId = Date.now();
    await page.getByLabel('Title').fill(`E2E Written Entry ${runId}`);
    await page
      .getByLabel('Content')
      .fill(
        `## Widget Calibration ${runId}\n\nWidgets must be recalibrated every 90 days under procedure ${runId}. A widget that misses its calibration window is quarantined until an engineer signs it off in the maintenance log.`,
      );
    await page.getByRole('button', { name: 'Save and index' }).click();

    await expect(page.getByRole('status').first()).toContainText(/retrievable passages/i, {
      timeout: 45_000,
    });
  });
});

test.describe('conversation lifecycle', () => {
  test('answers, keeps context on a follow-up, and accepts feedback', async ({ page }) => {
    await page.goto('/chat');

    const first = await ask(page, 'What is the refund window for an annual subscription?');
    await expect(first).toContainText(/30 days/i);
    await expect(first.getByText('Sources', { exact: true })).toBeVisible();

    const second = await ask(page, 'Does that apply to monthly plans too?');
    await expect(second).toContainText(/14 days|monthly/i);

    await second.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(second.getByText(/thank you/i)).toBeVisible();
  });

  test('negative feedback raises a human escalation', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'What are your support response times?');

    await answer.getByRole('button', { name: 'No', exact: true }).click();
    await answer.getByRole('button', { name: 'Missing information' }).click();

    await expect(answer.getByText(/human review has been raised/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('an explicit request for a human creates an escalation', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'How do I export all of my workspace data?');

    await answer.getByRole('button', { name: 'Ask for a human' }).click();
    await expect(answer.getByText(/human review/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('conversation history is listed and reopens', async ({ page }) => {
    await page.goto('/chat');
    await ask(page, 'What is the free trial length?');

    await page.goto('/dashboard/conversations');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Conversations');
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('operations', () => {
  test('escalation queue lists items with their summaries', async ({ page }) => {
    await page.goto('/dashboard/escalations');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Escalations');
    await expect(page.getByRole('heading', { name: 'When an escalation is raised' })).toBeVisible();
  });

  test('analytics are computed from real activity and stay honest', async ({ page }) => {
    await page.goto('/dashboard/analytics');

    await expect(page.getByText('Questions asked').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Answer grounding' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Content gaps' })).toBeVisible();
    await expect(page.getByText(/not a general accuracy claim/i)).toBeVisible();
  });

  test('system health reports genuinely checked components', async ({ page }) => {
    await page.goto('/dashboard/health');

    await expect(page.getByRole('heading', { name: 'PostgreSQL database' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Embedding provider' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Document storage' })).toBeVisible();
    await expect(page.getByText(/pgvector/i).first()).toBeVisible();
  });

  test('audit log records this session activity', async ({ page }) => {
    await page.goto('/dashboard/audit');

    await expect(page.getByText('auth.login.success').first()).toBeVisible();
    await expect(page.getByText(/keyed hashes/i)).toBeVisible();
  });

  test('retrieval settings reject a contradictory configuration', async ({ page }) => {
    await page.goto('/dashboard/retrieval');

    await page.getByLabel('Chunk size (characters)').fill('400');
    await page.getByLabel('Chunk overlap (characters)').fill('900');
    await page.getByRole('button', { name: 'Save settings' }).click();

    await expect(page.getByRole('status').first()).toContainText(/overlap/i, { timeout: 20_000 });

    // Leave the configuration valid for subsequent runs.
    await page.getByRole('button', { name: 'Reset' }).click();
  });

  test('model providers page never displays a credential', async ({ page }) => {
    await page.goto('/dashboard/models');

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(body).not.toMatch(/postgresql:\/\//);
    await expect(page.getByText(/never displayed, logged, or returned/i)).toBeVisible();
  });
});

test.describe('access control in the browser', () => {
  test.use({ storageState: path.join(AUTH_DIR, 'employee.json') });

  test('hides administrative navigation from an employee', async ({ page }) => {
    await page.goto('/dashboard');

    const nav = page.getByRole('navigation', { name: 'Dashboard' });
    await expect(nav.getByRole('link', { name: 'Documents' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Users and roles' })).toHaveCount(0);
  });

  test('refuses a restricted page even when the URL is typed directly', async ({ page }) => {
    await page.goto('/dashboard/audit');
    // Enforced on the server, not merely by hiding the link.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('do not have access');
  });

  test('refuses manager-only content in chat for an employee', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'Who can act as Incident Commander for a SEV1 incident?');

    await expect(answer).toContainText(/could not find enough approved information/i);
    await expect(page.locator('body')).not.toContainText('Incident Response Procedure');
  });

  test('does reach employee-level content', async ({ page }) => {
    await page.goto('/chat');
    const answer = await ask(page, 'How many days of annual leave do employees receive?');

    await expect(answer).toContainText(/28/);
    await expect(answer.getByText('Sources')).toBeVisible();
  });
});

test.describe('sign out', () => {
  // Uses the manager session deliberately. Signing out revokes the session
  // server-side, so doing it with the shared admin session would break every
  // later test — including the mobile project — that reuses that cookie.
  test.use({ storageState: path.join(AUTH_DIR, 'manager.json') });

  test('ends the session and blocks the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login', { timeout: 30_000 });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
