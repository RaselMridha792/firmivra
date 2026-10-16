import { expect, test } from '@playwright/test';

// Create Staff success page, in mock mode (playwright.mock.config.ts), signed in as the Owner.
// The account is created from step 1 so the page shows a real invited member. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the new member, resends the invitation and links onward', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/new`);
  await page.getByLabel('First Name *').fill('Morgan');
  await page.getByLabel('Last Name *').fill('Lee');
  await page.getByLabel('Work Email *').fill('morgan.lee@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByLabel('Employment Type').selectOption({ label: 'W-2 Employee' });
  await page.getByRole('button', { name: 'Create Account' }).click();
  // The Success page may compile on first use in dev, so the wait is longer.
  await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\/created$/, { timeout: 30_000 });
  const id = page.url().split('/team/')[1]?.split('/')[0] ?? '';

  await expect(page).toHaveTitle('Staff account created');
  await expect(page.getByTestId('page-title')).toHaveText('Staff Account Created Successfully!');
  await expect(page.getByTestId('created-summary-line')).toContainText('Morgan Lee has been added');
  const summary = page.getByTestId('staff-summary');
  await expect(summary).toContainText('Invited');
  await expect(summary).toContainText('morgan.lee@example.test');
  await expect(summary).toContainText('W-2 Employee');
  await expect(summary).toContainText('Standard User');

  await page.getByRole('button', { name: 'Resend Invitation' }).click();
  await expect(page.getByTestId('resent')).toBeVisible();

  await expect(page.getByRole('link', { name: 'View Staff Profile' })).toHaveAttribute(
    'href',
    `/team/${id}`,
  );
  await expect(page.getByRole('link', { name: 'Add Another Staff Member' })).toHaveAttribute(
    'href',
    '/team/new',
  );
  await expect(page.getByRole('link', { name: 'Security Best Practices' })).toHaveAttribute(
    'href',
    `/team/${id}/security`,
  );
});

test('names documents that did not upload, and keeps every card for an unknown account', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/00000000-0000-4000-8000-00000000dead/created?documentsFailed=2`,
  );
  await expect(page.getByText('2 documents did not upload.')).toBeVisible();
  await expect(page.getByTestId('staff-summary')).toContainText('Could not load this right now.');
  await expect(page.getByRole('button', { name: 'Resend Invitation' })).toBeDisabled();
  await expect(page.getByText('Security Reminders')).toBeVisible();
  await expect(page.getByText('Helpful Resources')).toBeVisible();
});
