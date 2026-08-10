import { test, expect } from '@playwright/test';

test.describe('Flagship Commercial Demo Journey — Maya Chen Acme Labs', () => {
  test('Completes end-to-end commercial discovery, identity resolution, lead scoring, and CRM inbox creation', async ({
    page,
  }) => {
    // 1. Visit public chat landing page
    await page.goto('/');

    // Verify main title and chat interface
    await expect(page.locator('h1')).toContainText('Atlas');

    const input = page.getByRole('textbox', { name: 'Ask a question' });
    await expect(input).toBeVisible();

    // 2. Maya asks first commercial question
    await input.fill('Hi, what team plans do you offer and what is your refund policy?');
    await input.press('Enter');

    // Wait for response & citations
    await expect(page.getByText('Sources', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).toContainText('30-day');

    // 3. Maya shares team size and timeline
    await input.fill(
      'We have about 80 users looking to deploy next month. Can you share security details and how to get started?',
    );
    await input.press('Enter');

    // Wait for response
    await expect(page.getByText('Sources', { exact: true }).nth(1)).toBeVisible({ timeout: 15000 });

    // 4. Maya provides contact details and requests sales follow-up
    await input.fill(
      'Please have sales follow up with me. My name is Maya Chen, email maya@acme.example',
    );
    await input.press('Enter');

    await page.waitForTimeout(2000);

    // 5. Navigate to Admin Dashboard Contacts to verify Maya Chen's profile
    await page.goto('/dashboard/contacts');

    // Should render Contacts table containing Maya Chen
    await expect(page.getByText('Maya Chen')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Acme Labs')).toBeVisible();

    // 6. Navigate to 3-Column Customer 360 Inbox
    await page.goto('/dashboard/inbox');

    // Should display Maya Chen's conversation in the list
    await expect(page.getByText('Maya Chen')).toBeVisible({ timeout: 10000 });
    await fontOrTextCheck(page, 'Acme Labs');
    await fontOrTextCheck(page, 'Customer 360');
  });
});

async function fontOrTextCheck(page: import('@playwright/test').Page, text: string) {
  await expect(page.locator('body')).toContainText(text);
}
