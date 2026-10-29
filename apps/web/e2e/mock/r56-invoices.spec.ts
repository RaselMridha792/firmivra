import { expect, test } from '@playwright/test';

// R56: Invoices & Payments in mock mode (every module on mock data, as an Owner): R7's fifteen
// invoices; INV-2026-0098 ($225.00) is the one overdue.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Payment Methods: the money collected this year by method (IP-F20, D1)', async ({ page }) => {
  await page.goto(app('/invoices'));
  const chart = page.getByTestId('invoice-methods-chart');
  // Stripe's card payments and the check recorded by hand; the voided cash payment is left out.
  const legend = chart.getByRole('listitem');
  await expect(legend).toHaveCount(2);
  await expect(legend.nth(0)).toContainText('Card');
  await expect(legend.nth(1)).toContainText('Check');
  const picker = chart.getByLabel('Payment method');
  await expect(picker.locator('option')).toHaveText(['All', 'Card', 'Cash', 'ACH', 'Check']);
  await picker.selectOption({ label: 'Check' });
  await expect(legend).toHaveCount(1);
  await expect(legend.first()).toContainText('Check');
  await picker.selectOption({ label: 'ACH' });
  await expect(chart).toContainText('No ACH payments this year yet.');
});

test('Overview: KPIs, the three charts, tabs with counts, filters and paging', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await expect(page.getByTestId('page-title')).toHaveText('Invoices & Payments');
  const kpis = page.getByTestId('invoice-kpis');
  for (const label of [
    'Total Outstanding',
    'Paid This Month',
    'Overdue',
    'Due Today',
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

test('Due rules on the firm’s calendar: the Due Today tab and the tags (IP-F06)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const tabs = page.getByRole('tablist', { name: 'Invoice views' });
  for (const name of [/^Due Soon/, /^Due Tomorrow/, /^Due Today/, /^Overdue/])
    await expect(tabs.getByRole('tab', { name })).toBeVisible();
  await tabs.getByRole('tab', { name: /^Overdue/ }).click();
  await expect(page.getByTestId('invoice-row').first()).toContainText('Overdue');
  await tabs.getByRole('tab', { name: /^Due Today/ }).click();
  const rows = page.getByTestId('invoice-row');
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) await expect(rows.nth(i)).toContainText('Due Today');
});

test('Sent is its own tag: the Sent tab lists dispatched invoices, overdue too (IP-F07)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByLabel('Search invoices').fill('0098');
  const tabs = page.getByRole('tablist', { name: 'Invoice views' });
  await tabs.getByRole('tab', { name: /^Sent/ }).click();
  const rows = page.getByTestId('invoice-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Overdue');
  await expect(rows.first()).toContainText('Sent');
  await tabs.getByRole('tab', { name: /^Not Sent/ }).click();
  await expect(rows).toHaveCount(0);
});

test('Correct Dates: a sent invoice gets a later due date with a reason (IP-F08)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByLabel('Search invoices').fill('0098');
  const row = page.getByTestId('invoice-row').first();
  await expect(row).toContainText('Overdue');
  await page.getByRole('button', { name: 'Actions for INV-2026-0098' }).click();
  await page.getByRole('menuitem', { name: 'Correct Dates' }).click();
  const dialog = page.getByRole('dialog');
  const later = await page.evaluate(() =>
    new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
  );
  await dialog.getByLabel('Due date').fill(later);
  await dialog.getByRole('button', { name: 'Save Dates' }).click();
  await expect(dialog.getByText('Say why the sent invoice changes.')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Fake: the client asked for more time');
  await dialog.getByRole('button', { name: 'Save Dates' }).click();
  await expect(page.getByText('INV-2026-0098 corrected.')).toBeVisible();
  await expect(row).not.toContainText('Overdue');
});

test('Row menu: Send Reminder first, notes in the history, a message and a task (IP-F09)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByLabel('Search invoices').fill('0098');
  const open = () => page.getByRole('button', { name: 'Actions for INV-2026-0098' }).click();
  await open();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toHaveText('Send Reminder');
  for (const name of [
    'Preview Invoice',
    'Download PDF',
    'View Client Portal',
    'Create Task',
    'Schedule Follow-Up',
    'Add Note',
    'Log Activity',
  ])
    await expect(page.getByRole('menuitem', { name })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add Note' }).click();
  await page.getByRole('dialog').getByLabel('Note (firm only)').fill('Fake: will pay Friday');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Note added. (INV-2026-0098)')).toBeVisible();

  await open();
  await page.getByRole('menuitem', { name: 'Send Reminder' }).click();
  await expect(page.getByRole('dialog').getByLabel(/Subject/)).toHaveValue(
    /^Reminder: invoice INV-2026-0098/,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await open();
  await page.getByRole('menuitem', { name: 'View Invoice', exact: true }).click();
  await expect(page.getByTestId('invoice-history')).toContainText('Fake: will pay Friday');
  await page.goBack();
  await page.getByLabel('Search invoices').fill('0098');
  await open();
  await page.getByRole('menuitem', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?clientId=/);
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
