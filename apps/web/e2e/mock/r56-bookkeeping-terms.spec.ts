import { expect, test } from '@playwright/test';

// BK-E01 (Octavia's Oct 25 review): the client's Terms page with its six areas, on R55's Terms
// API (mocks/bookkeeping-terms.ts). Green Leaf Café LLC has terms in force; Turner Group LLC has
// none. Terms in force are read-only; a change is a new version. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';
const TURNER = '0199c0f0-b100-7000-8000-000000000002';

test('the Terms page shows the six areas and the terms in force, read-only', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  await page.getByRole('tab', { name: 'Terms' }).click();
  await expect(page).toHaveURL(new RegExp(`/bookkeeping/clients/${GREEN}/terms`));
  await expect(page.getByTestId('page-title')).toHaveText('Terms');
  const tabs = page.getByRole('tablist', { name: 'Terms areas' }).getByRole('tab');
  await expect(tabs).toHaveText([
    'Terms',
    'Service Details',
    'Billing & Payments',
    'Engagement Documents',
    'Renewal & Notices',
    'History',
  ]);
  await expect(page.getByTestId('terms-version')).toContainText('Version 1');
  await expect(page.getByTestId('terms-version')).toContainText('In force');
  await expect(page.getByTestId('terms-read-only')).toBeVisible();
  const pkg = page.getByRole('textbox', { name: 'Package', exact: true });
  await expect(pkg).toHaveValue('Growth Plan');
  await expect(pkg).toBeDisabled();
  await expect(page.getByTestId('terms-included')).toContainText('Transaction categorization');
  await expect(page.getByTestId('terms-schedule').getByRole('row')).toHaveCount(6);
  await expect(page.getByTestId('terms-preview')).toContainText('BOOKKEEPING SERVICES AGREEMENT');
});

test('a new version is a draft: edited, saved, and its change shows in History', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}/terms`);
  await page.getByRole('button', { name: 'New Version' }).click();
  await expect(page.getByTestId('terms-version')).toContainText('Version 2');
  await expect(page.getByTestId('terms-version')).toContainText('Draft');
  await expect(page.getByTestId('terms-version')).toContainText(
    'Version 1 stays in force until this one is activated.',
  );
  const fee = page.getByLabel('Monthly Fee ($)');
  await expect(fee).toBeEnabled();
  await fee.fill('310');
  await page.getByLabel('Add an included service').fill('Fake cash-flow forecast');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Terms saved.')).toBeVisible();
  await expect(page.getByTestId('terms-preview')).toContainText('$310.00');
  await expect(page.getByTestId('terms-included')).toContainText('Fake cash-flow forecast');

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page).toHaveURL(/tab=history/);
  const history = page.getByTestId('terms-history');
  await expect(history).toContainText('Version 2 · Created');
  await expect(history).toContainText('Version 1 · Came into force');
});

test('Renewal & Notices records a price change notice on the terms in force', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}/terms?tab=renewal`);
  const renewal = page.getByTestId('terms-renewal');
  await expect(renewal).toContainText('Auto-renew');
  await renewal.getByLabel('New monthly fee ($)').fill('320');
  await renewal.getByLabel('Reason or note').fill('Fake annual price review');
  await renewal.getByRole('button', { name: 'Record Notice' }).click();
  await expect(page.getByText('Notice recorded.')).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByTestId('terms-history')).toContainText(
    'Price change notice: monthly fee $290.00 → $320.00',
  );
});

test('a client with no terms says so and offers Create Terms', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${TURNER}/terms`);
  await expect(page.getByTestId('no-terms')).toContainText('No terms are set up for');
  await page.getByRole('button', { name: 'Create Terms' }).click();
  await expect(page.getByTestId('terms-version')).toContainText('Version 1');
  await expect(page.getByTestId('terms-version')).toContainText('Draft');
  await expect(page.getByTestId('terms-schedule')).toContainText('No invoices yet');
});
