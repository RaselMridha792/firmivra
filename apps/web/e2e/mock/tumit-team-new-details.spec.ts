import { expect, type Page, test } from '@playwright/test';

// Create Staff step 4 (Additional Details) and Submit & Send Invitation, in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock keeps drafts in the page's
// memory, so the test walks from step 1. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

async function toStep4(page: Page, email: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/new`);
  await page.getByLabel('First Name *').fill('Jasmine');
  await page.getByLabel('Last Name *').fill('Roberts');
  await page.getByLabel('Work Email *').fill(email);
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
}

test('fills the details, queues a document and submits the account', async ({ page }) => {
  await toStep4(page, 'jasmine.roberts@example.test');
  await expect(page).toHaveTitle('Create staff: Additional details');
  await expect(page.getByTestId('account-preview')).toContainText('Jasmine Roberts');

  await page.getByLabel('Employment Type').selectOption({ label: 'W-2 Employee' });
  await expect(page.getByTestId('account-preview')).toContainText('W-2 Employee');
  await page.getByLabel('Work Schedule').selectOption({ label: 'Full-Time' });
  await page.getByLabel('Primary Team').selectOption({ label: 'Individual Tax' });
  await page.getByLabel('Maximum Workload (Optional)').fill('lots');
  await page.getByRole('button', { name: 'Submit & Send Invitation' }).click();
  await expect(page.getByText('Use a whole number from 1 to 10,000.')).toBeVisible();
  await page.getByLabel('Maximum Workload (Optional)').fill('50');

  await page.getByLabel('Pay Type').selectOption({ label: 'Salary' });
  await page.getByLabel('Pay Rate / Salary').fill('55000');
  await page.getByLabel('Pay Frequency').selectOption({ label: 'Twice a month' });

  // A document waits in the table and uploads once the account exists.
  await expect(page.getByText('Max size: 100 MB per file')).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'Jasmine_Roberts_W4.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic test file'),
  });
  const docs = page.getByTestId('staff-documents');
  await expect(docs).toContainText('Jasmine_Roberts_W4.pdf');
  await docs
    .getByLabel('Document type of Jasmine_Roberts_W4.pdf')
    .selectOption({ label: 'W-4 Form' });

  await page.getByRole('button', { name: 'Submit & Send Invitation' }).click();
  // The Success page may compile on first use in dev, so the wait is longer.
  await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\/created$/, { timeout: 30_000 });
});

test('the draft keeps the details but never the pay', async ({ page }) => {
  await toStep4(page, 'jasmine.r2@example.test');
  await page.getByLabel('Employee ID (Optional)').fill('EMP777');
  await page.getByLabel('Pay Rate / Salary').fill('40000');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/);
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page.getByLabel('Employee ID (Optional)')).toHaveValue('EMP777');
  await expect(page.getByLabel('Pay Rate / Salary')).toHaveValue('');
});
