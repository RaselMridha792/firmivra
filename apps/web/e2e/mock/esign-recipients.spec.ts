import { expect, type Page, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** A new draft with no client, open on its Recipients step. */
async function draft(page: Page) {
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Synthetic Recipients Test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  await page
    .getByRole('navigation', { name: 'Steps' })
    .getByRole('link', { name: 'Recipients' })
    .click();
  await expect(page.getByRole('heading', { name: 'Recipients', exact: true })).toBeVisible();
}

test('add two outside signers, fix a missing email, reorder and save', async ({ page }) => {
  await draft(page);
  await expect(page.getByText('Add a signer to continue.')).toBeVisible();
  const rows = page.getByTestId('recipient-row');

  await page.getByRole('button', { name: 'Add a signer' }).click();
  await rows.nth(0).getByLabel('Name').fill('Pat Example');
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(rows.nth(0).getByText(/invalid email/i)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next: Fields' })).toHaveCount(0);

  await rows.nth(0).getByLabel('Email').fill('pat@example.com');
  await page.getByRole('button', { name: 'Add a signer' }).click();
  await rows.nth(1).getByLabel('Name').fill('Robin Example');
  await rows.nth(1).getByLabel('Email').fill('robin@example.com');
  await rows.nth(1).getByLabel('Role').selectOption({ label: 'Spouse' });
  await page.getByRole('button', { name: 'Move 2. Signer up' }).click();
  await expect(rows.nth(0).getByLabel('Name')).toHaveValue('Robin Example');
  await expect(page.getByText('Save your changes to continue.')).toBeVisible();

  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(page.getByRole('link', { name: 'Next: Fields' })).toBeVisible();
  // The saved order is what the request now holds (the mock lives in the page, so no reload).
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await steps.getByRole('link', { name: 'Documents' }).click();
  await steps.getByRole('link', { name: 'Recipients' }).click();
  await expect(rows.nth(0).getByLabel('Name')).toHaveValue('Robin Example');
  await expect(rows.nth(1).getByLabel('Name')).toHaveValue('Pat Example');
});

test('a new access code is required, and all at once drops the order numbers', async ({ page }) => {
  await draft(page);
  const row = page.getByTestId('recipient-row').first();
  await page.getByRole('button', { name: 'Add a signer' }).click();
  await row.getByLabel('Name').fill('Sam Example');
  await row.getByLabel('Email').fill('sam@example.com');
  await row.getByLabel('Identity check').selectOption({ label: 'An access code you give them' });
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(row.getByText('Set an access code')).toBeVisible();
  await row.getByLabel('Access code').fill('SYNTH42');
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(page.getByRole('link', { name: 'Next: Fields' })).toBeVisible();

  await expect(row.getByRole('heading', { name: '1. Signer' })).toBeVisible();
  await page.getByLabel('Signing order').selectOption({ label: 'All at once' });
  await expect(row.getByRole('heading', { name: 'Signer', exact: true })).toBeVisible();
});

test('an approver must be picked from the firm', async ({ page }) => {
  await draft(page);
  await page.getByRole('button', { name: 'Add an approver' }).click();
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(page.getByText('Choose who approves')).toBeVisible();
  await page.getByRole('button', { name: 'Remove 1. Approver' }).click();
  await expect(page.getByTestId('recipient-row')).toHaveCount(0);
  await expect(page.getByText('Save your changes to continue.')).toBeVisible();
});
