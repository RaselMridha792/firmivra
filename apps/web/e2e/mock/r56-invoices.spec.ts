import { expect, test } from '@playwright/test';

// R56: Invoices & Payments in mock mode (every module on mock data, as an Owner): R7's fifteen
// invoices; INV-2026-0098 ($225.00) is the one overdue.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Overview: KPIs, the three charts, tabs with counts, filters and paging', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await expect(page.getByTestId('page-title')).toHaveText('Invoices & Payments');
  const kpis = page.getByTestId('invoice-kpis');
  for (const label of [
    'Total Outstanding',
    'Paid This Month',
    'Overdue',
    'Due Soon',
    'Total Collected',
  ])
    await expect(kpis).toContainText(label);
  await expect(kpis).toContainText('$225');
  await expect(page.getByTestId('invoice-activity')).toBeVisible();
  await expect(page.getByTestId('invoice-status-chart')).toContainText('15');
  await expect(page.getByTestId('invoice-methods-chart')).toBeVisible();
  await expect(page.getByTestId('payment-gateway')).toContainText('Stripe');
  const tabs = page.getByRole('tablist', { name: 'Invoice views' });
  await expect(tabs.getByRole('tab').first()).toContainText('15');
  const rows = page.getByTestId('invoice-row');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1–10 of 15 invoices')).toBeVisible();
  await tabs.getByRole('tab', { name: /^Overdue/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('INV-2026-0098');
  await tabs.getByRole('tab', { name: /^All Invoices/ }).click();
  await page.getByLabel('Search invoices').fill('0107');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Draft');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(rows).toHaveCount(10);
});

test('Create Invoice: a two-line draft, then send it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/new'));
  await expect(page.getByTestId('page-title')).toHaveText('Create Invoice');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Choose a client')).toBeVisible();
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Due Date *').fill('2099-10-31');
  await page.getByLabel('Description 1 *').fill('Quarterly bookkeeping review');
  await page.getByLabel('Rate 1 *').fill('350');
  await page.getByRole('button', { name: 'Add Line Item' }).click();
  await page.getByLabel('Description 2 *').fill('Payroll setup');
  await page.getByLabel('Qty 2 *').fill('2');
  await page.getByLabel('Rate 2 *').fill('100');
  await expect(page.getByTestId('invoice-total')).toHaveText('$550.00');
  await page.getByLabel('Discount ($)').fill('50');
  await expect(page.getByTestId('invoice-total')).toHaveText('$500.00');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByTestId('invoice-detail')).toContainText('Draft');
  await expect(page.getByTestId('invoice-balance')).toHaveText('$500.00');
  await page.getByRole('button', { name: 'Send Invoice' }).click();
  await expect(page.getByTestId('invoice-detail')).toContainText('Sent');
});

test('Record Payment: part of the overdue invoice, then it shows on the invoice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page
    .getByRole('tablist', { name: 'Invoice views' })
    .getByRole('tab', { name: /^Overdue/ })
    .click();
  await page.getByRole('button', { name: 'Actions for INV-2026-0098' }).click();
  await page.getByRole('menuitem', { name: 'Record Payment' }).click();
  await expect(page.getByTestId('selected-invoice')).toContainText('INV-2026-0098');
  await page.getByLabel('Amount Received ($) *').fill('500');
  await page.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByText('Enter at most $225.00')).toBeVisible();
  await page.getByLabel('Amount Received ($) *').fill('25');
  await page.getByLabel('Payment Method *').selectOption('CASH');
  await expect(page.getByTestId('remaining-balance')).toHaveText('$200.00');
  await page.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByTestId('invoice-payments')).toContainText('$25.00');
  await expect(page.getByTestId('invoice-balance')).toHaveText('$200.00');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  for (const path of ['/invoices', '/invoices/new', '/invoices/record-payment']) {
    await page.goto(app(path));
    await expect(page.getByTestId('page-title')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      path,
    ).toBeTruthy();
  }
});
