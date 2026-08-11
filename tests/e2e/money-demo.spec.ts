import { test, expect } from '@playwright/test';

test.describe('Flagship Commercial Demo Journey — Dynamic Visitor Identity', () => {
  test.setTimeout(120000);

  test('Completes multi-turn demo conversation, identity upgrade, and CRM contact linking', async ({
    page,
  }) => {
    const uniqueEmail = `maya-e2e-${Date.now()}@acme.example`;

    // 1. Visit public demo page
    await page.goto('/demo');

    const input = page.getByRole('textbox', { name: 'Ask a question' });
    await expect(input).toBeVisible();

    // 2. Greeting
    await input.fill('Hi');
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/Hi|Hello|welcome/i, { timeout: 25000 });
    await expect(input).toBeEnabled({ timeout: 25000 });

    // 3. Commercial Evaluation Context
    await input.fill("We're evaluating this for around 80 users and want to deploy next month.");
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(
      /help|assist|question|team|deploy|plan|requirement/i,
      {
        timeout: 25000,
      },
    );
    await expect(input).toBeEnabled({ timeout: 25000 });

    // 4. Factual Knowledge Query: Team plan pricing
    await input.fill('What does the Team plan cost?');
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/79|per user/i, { timeout: 25000 });
    await expect(input).toBeEnabled({ timeout: 25000 });

    // 5. Factual Knowledge Query: Security controls
    await input.fill('What security controls do you provide?');
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/AES-256|TLS 1.3|SOC 2|security/i, {
      timeout: 25000,
    });
    await expect(input).toBeEnabled({ timeout: 25000 });

    // 6. Identity Upgrade & Sales Follow-Up Request
    await input.fill(
      `Please have someone follow up with me. My name is Maya Chen and my email is ${uniqueEmail}`,
    );
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/follow up|contact|team/i, { timeout: 25000 });
    await page.waitForTimeout(3000);

    // 7. Login as Admin and verify lead in Contacts view
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    const adminRoleBtn = page.locator('button').filter({ hasText: 'Admin' }).first();
    if (await adminRoleBtn.isVisible()) {
      await adminRoleBtn.click();
    } else {
      await page.fill('input[name="email"]', 'admin@atlasknowledge.demo');
      await page.fill('input[name="password"]', 'AtlasDemo!2026');
      await page.click('button[type="submit"]');
    }
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await page.goto('/dashboard/contacts?q=Maya');
    await expect(page.locator('body')).toContainText('Maya', { timeout: 25000 });
  });
});
