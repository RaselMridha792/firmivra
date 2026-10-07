import { expect, test } from '@playwright/test';

// The reference screen in mock mode (playwright.mock.config.ts): copy this test for your screen.
// The mock is the lead's createTaxStatusesMock: 6 active statuses and 1 archived, API rules.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/settings/tax-statuses`;

test('owner lists, adds, renames, reorders and archives tax statuses', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  const names = page.getByTestId('tax-status-name');
  await expect(names).toHaveCount(6);
  await expect(names.first()).toHaveText('Waiting for documents');

  // Add, then the same name again: the API's DUPLICATE_NAME comes back as a readable message.
  await page.getByTestId('new-status-name').fill('Waiting for signature');
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(names).toHaveCount(7);
  await page.getByTestId('new-status-name').fill('Waiting for signature');
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(page.getByText('A status with this name already exists.')).toBeVisible();

  // Rename.
  await page.getByRole('button', { name: 'Rename Filed' }).click();
  await page.getByLabel('New name for Filed').fill('Filed with the IRS');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(names.filter({ hasText: 'Filed with the IRS' })).toHaveCount(1);

  // Reorder: the first status moves down one place.
  await page.getByRole('button', { name: 'Move Waiting for documents down' }).click();
  await expect(names.nth(1)).toHaveText('Waiting for documents');

  // Archive: the status leaves the list.
  await page.getByRole('button', { name: 'Archive Accepted' }).click();
  await expect(names.filter({ hasText: 'Accepted' })).toHaveCount(0);
});

test('an empty name is caught by the form before any request', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(page.getByTestId('new-status-name')).toHaveAttribute('aria-invalid', 'true');
});
