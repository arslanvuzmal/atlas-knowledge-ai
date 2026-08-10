import { test, expect } from '@playwright/test';

test.describe('Flagship Commercial Demo Journey — Dynamic Visitor Identity', () => {
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
    await expect(page.locator('body')).toContainText(/Hi|Hello|welcome/i, { timeout: 10000 });

    // 3. Commercial Evaluation Context
    await input.fill("We're evaluating this for around 80 users and want to deploy next month.");
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/requirements|pricing|security/i, {
      timeout: 10000,
    });

    // 4. Factual Knowledge Query: Team plan pricing
    await input.fill('What does the Team plan cost?');
    await input.press('Enter');
    await expect(page.getByText(/79|per user/i)).toBeVisible({ timeout: 15000 });

    // 5. Factual Knowledge Query: Security controls
    await input.fill('What security controls do you provide?');
    await input.press('Enter');
    await expect(page.getByText(/AES-256|TLS 1.3|SOC 2/i)).toBeVisible({ timeout: 15000 });

    // 6. Identity Upgrade & Sales Follow-Up Request
    await input.fill(
      `Please have someone follow up with me. My name is Maya Chen and my email is ${uniqueEmail}`,
    );
    await input.press('Enter');
    await expect(page.locator('body')).toContainText(/follow up|contact/i, { timeout: 15000 });

    // 7. Verify in Admin Contacts view
    await page.goto('/dashboard/contacts');
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 15000 });
  });
});
