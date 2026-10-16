import { expect, test } from '@playwright/test';

// Create Staff step 1 (Account Information), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. R42's staff mock: active departments Tax, Bookkeeping...; Morgan Avery owns the
// firm. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/new`;

test('checks the required fields, previews the account and creates it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Create staff: Account information');
  await expect(page.getByTestId('page-title')).toHaveText('Create Staff Account');
  await expect(page.getByRole('list', { name: 'Create staff steps' })).toBeVisible();

  // Nothing filled: the contract's checks name each missing field.
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText('Enter a first name.')).toBeVisible();
  await expect(page.getByText('Choose at least one department.')).toBeVisible();
  await expect(page.getByText('Choose a role.')).toBeVisible();

  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Stone');
  await page.getByLabel('Work Email *').fill('avery.stone@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByLabel('Employment Type').selectOption({ label: 'Full-Time' });

  // The preview follows the form.
  const preview = page.getByTestId('account-preview');
  await expect(preview).toContainText('Avery Stone');
  await expect(preview).toContainText('Tax Preparer');
  await expect(preview).toContainText('Full-Time');

  await page.getByRole('button', { name: 'Create Account' }).click();
  // The Success page may compile on first use in dev, so the wait is longer.
  await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\/created$/, { timeout: 30_000 });
});

test('Save as Draft keeps the form and Next opens step 2 with the draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByLabel('First Name *').fill('Jordan');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('draft-saved')).toBeVisible();
  await expect(page).toHaveURL(/\/team\/new\?draft=/);

  // An address that is not an email is caught before anything is sent.
  await page.getByLabel('Last Name *').fill('Lee');
  await page.getByLabel('Work Email *').fill('not-an-email');
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page.getByText('Enter a valid work email.')).toBeVisible();

  await page.getByLabel('Work Email *').fill('jordan.lee@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Bookkeeping' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Bookkeeper');
  await page.getByLabel('Role *').selectOption({ label: 'Bookkeeper' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
});
