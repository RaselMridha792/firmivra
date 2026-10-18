import { expect, test, type Page } from '@playwright/test';

// Super Admin Billing (S01) on the adminBilling mock: the dashboard, Create Invoice, Invoice
// Details and Edit Invoice. The mock config runs NEXT_PUBLIC_API_MOCK=all, which also signs the
// console in as Morgan Admin. Dates in the mock are relative to today, so statuses are stable.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
/** INV-0019: Taylor Corporate, $2,450.00, pending, with an engagement letter attached. */
const TAYLOR = '0199d1a0-0b02-7000-8000-000000000019';

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('the Billing dashboard lists invoices with totals, tabs, filters and quick actions', async ({
  page,
}) => {
  await page.goto(admin('/billing'));
  await expect(page.getByTestId('page-title')).toHaveText('Billing');
  await expect(page.getByTestId('kpi-invoiced-value')).toContainText('$');
  await expect(page.getByTestId('kpi-overdue')).toContainText('4 invoices');

  const tabs = page.getByRole('navigation', { name: 'Billing sections' });
  await expect(tabs.getByRole('link', { name: 'Invoices' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tabs.getByRole('link', { name: 'Payments' })).toHaveAttribute(
    'href',
    '/billing/payments',
  );

  const rows = page.getByTestId('invoice-table').locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1–10 of 26 invoices')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search invoices' }).fill('Taylor');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Taylor Corporate');
  await page.getByRole('searchbox', { name: 'Search invoices' }).clear();

  await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Overdue' });
  await expect(rows).toHaveCount(4);
  for (const badge of await rows.getByTestId('status-badge').all()) {
    await expect(badge).toHaveText('Overdue');
  }
  await expect(page.getByTestId('kpi-invoiced')).toContainText('Across 4 invoices');

  await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Billing Settings/ })).toHaveAttribute(
    'href',
    '/billing/settings',
  );
});

test('a row menu records a payment on an open invoice', async ({ page }) => {
  await page.goto(admin('/billing'));
  await page.getByRole('searchbox', { name: 'Search invoices' }).fill('INV-0019');
  await expect(page.getByTestId('invoice-table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Actions for INV-0019' }).click();
  await page.getByRole('menuitem', { name: 'Record Payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Payment' });
  await dialog.getByLabel('Payment Amount').fill('2450');
  await dialog.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'Payment of $2,450.00 recorded on INV-0019.',
  );
  await expect(page.getByTestId('invoice-table').getByTestId('status-badge')).toHaveText('Paid');
});

test('Create Invoice checks the form, previews live and saves a draft', async ({ page }) => {
  await page.goto(admin('/billing/invoices/new'));
  await expect(page.getByTestId('page-title')).toHaveText('Create Invoice');
  await expect(page.locator('#invoice-number')).toHaveValue('INV-0027');

  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByText('Select a firm', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Description, line 1')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#invoice-firm').selectOption({ label: 'LVP Accounting & Taxes' });
  await page.locator('#invoice-client').selectOption({ label: 'Brown Consulting' });
  await page.getByLabel('Description, line 1').fill('Advisory retainer');
  await page.getByLabel('Rate, line 1').fill('1200');
  await page.getByRole('button', { name: 'Add Line Item' }).click();
  await page.getByLabel('Description, line 2').fill('Filing fee');
  await page.getByLabel('Quantity, line 2').fill('2');
  await page.getByLabel('Rate, line 2').fill('25');

  const preview = page.getByTestId('invoice-preview');
  await expect(preview).toContainText('LVP Accounting & Taxes');
  await expect(preview).toContainText('Brown Consulting');
  await expect(preview.getByTestId('invoice-total')).toHaveText('$1,250.00');

  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page).toHaveURL(/\/billing\/invoices\/0199d1a0-0b02-[\d-]+\?saved=draft$/);
  await expect(page.getByTestId('page-title')).toHaveText('Invoice INV-0027');
  await expect(page.getByTestId('billing-notice')).toContainText('Invoice saved as a draft.');
  await expect(page.getByTestId('invoice-status-card')).toContainText('Draft');
});

test('Invoice Details shows the branded invoice and records a payment', async ({ page }) => {
  await page.goto(admin(`/billing/invoices/${TAYLOR}`));
  await expect(page.getByTestId('page-title')).toHaveText('Invoice INV-0019');
  await expect(page.getByTestId('status-badge').first()).toHaveText('Pending');
  const document = page.getByTestId('invoice-document');
  await expect(document).toContainText('LVP Accounting & Taxes');
  await expect(document).toContainText('Taylor Corporate');
  await expect(document.getByTestId('invoice-total')).toHaveText('$2,450.00');
  const related = page.getByTestId('related-documents');
  await expect(related).toContainText('INV-0019.pdf');
  await expect(related).toContainText('Engagement Letter.pdf');

  await page
    .getByTestId('invoice-status-card')
    .getByRole('button', { name: 'Record Payment' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Record Payment' });
  await dialog.getByLabel('Payment Amount').fill('450');
  await dialog.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'Payment of $450.00 recorded on INV-0019.',
  );
  await expect(page.getByTestId('status-badge').first()).toHaveText('Partially Paid');
  await expect(page.getByTestId('invoice-balance')).toHaveText('$2,000.00');
  await expect(page.getByTestId('payment-history')).toContainText('$450.00');
});

test('an unknown invoice keeps the page frames with a quiet line', async ({ page }) => {
  await page.goto(admin('/billing/invoices/0199d1a0-0b02-7000-8000-000000000999'));
  await expect(page.getByTestId('invoice-error').first()).toContainText("We couldn't find");
  await expect(page.getByRole('heading', { name: 'Invoice Status' })).toBeVisible();
});

test('Edit Invoice loads the invoice and saves a change', async ({ page }) => {
  await page.goto(admin(`/billing/invoices/${TAYLOR}/edit`));
  await expect(page.getByTestId('page-title')).toHaveText('Edit Invoice INV-0019');
  await expect(page.getByLabel('Description, line 1')).toHaveValue(
    'Corporate Tax Return Preparation',
  );
  await page.locator('#invoice-notes').fill('Synthetic note for the edit test.');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/billing/invoices/${TAYLOR}\\?saved=updated$`));
  await expect(page.getByTestId('billing-notice')).toContainText('Invoice changes saved.');
  await expect(page.getByTestId('invoice-document')).toContainText(
    'Synthetic note for the edit test.',
  );
});

for (const [name, path, ready] of [
  ['dashboard', '/billing', 'invoice-table'],
  ['create invoice', '/billing/invoices/new', 'invoice-preview'],
  ['invoice details', `/billing/invoices/${TAYLOR}`, 'invoice-document'],
  ['edit invoice', `/billing/invoices/${TAYLOR}/edit`, 'invoice-preview'],
] as const) {
  test(`Billing ${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByTestId(ready)).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}
