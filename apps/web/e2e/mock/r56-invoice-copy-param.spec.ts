import { expect, type Page, test } from '@playwright/test';

// Dashboard live check Q4, Q8, B04 (R56): `from=` is only ever the way back (lib/origin.ts). + New ›
// New invoice and the dashboard's Create Invoice open a blank Create Invoice with Back to the
// dashboard, never "This invoice is not available"; Duplicate starts from a copy with
// `copyFrom=<id>`. Mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only:
// invoice 2 is INV-2026-0102, with two lines.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const invoice = (n: number) => `0199b6e1-0000-7000-8000-${String(n).padStart(12, '0')}`;

test.describe.configure({ timeout: 240_000 });

async function blankEditorWithBack(page: Page) {
  await expect(page).toHaveURL(/\/invoices\/new\?from=%2F$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Create Invoice' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('This invoice is not available')).toHaveCount(0);
  await expect(page.getByLabel('Client *')).toHaveValue('');
  await expect(page.getByLabel('Description 1 *')).toHaveValue('');
  await expect(page.getByTestId('back-to-origin')).toHaveText(/Back to Dashboard/);
}

test('+ New › New invoice and the Create Invoice quick action open a blank editor with Back to the dashboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'New invoice' }).click();
  await blankEditorWithBack(page);

  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/'), { timeout: 60_000 });
  await page
    .getByRole('region', { name: 'Quick actions' })
    .getByRole('link', { name: 'Create Invoice' })
    .click();
  await blankEditorWithBack(page);
});

test('Duplicate starts a new invoice from a copy, with copyFrom', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/invoices/${invoice(2)}`));
  const duplicate = page.getByRole('link', { name: 'Duplicate' });
  await expect(duplicate).toHaveAttribute('href', `/invoices/new?copyFrom=${invoice(2)}`, {
    timeout: 60_000,
  });
  await duplicate.click();
  await expect(page).toHaveURL(new RegExp(`/invoices/new\\?copyFrom=${invoice(2)}$`), {
    timeout: 60_000,
  });
  await expect(page.getByRole('heading', { name: 'Create Invoice' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByLabel('Client *')).not.toHaveValue('');
  await expect(page.getByLabel('Description 1 *')).toHaveValue(
    'Individual tax preparation (Form 1040)',
  );
  await expect(page.getByLabel('Description 2 *')).toHaveValue('Schedule C, business income');
});
