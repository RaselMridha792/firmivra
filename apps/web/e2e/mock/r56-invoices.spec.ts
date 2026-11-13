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

test('The list keeps its filters in the address; Templates goes back to it; the charts take ranges and a status (IP-F11, F21)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  // IP-F21: Payment Status by range and status, with a wrong range said in place.
  const status = page.getByTestId('invoice-status-chart');
  await status.getByLabel('Status counted').selectOption('PAID');
  await expect(status).toContainText('Paid');
  await status.getByLabel('Invoices counted').selectOption('custom');
  await status.getByLabel('From').fill('2026-12-31');
  await status.getByLabel('To').fill('2026-01-01');
  await expect(status.getByRole('alert')).toHaveText(
    'The start date must be on or before the end date.',
  );
  await status.getByLabel('Status counted').selectOption('');
  await status.getByLabel('Invoices counted').selectOption('all');
  await expect(status).toContainText('15');
  // Invoice Activity: a custom range of months, each labelled with its year.
  const activity = page.getByTestId('invoice-activity');
  await activity.getByLabel('Activity range').selectOption('custom');
  await activity.getByLabel('First month').fill('2026-12');
  await activity.getByLabel('Last month').fill('2026-01');
  await expect(activity.getByRole('alert')).toHaveText(
    'The first month must be on or before the last.',
  );
  await activity.getByLabel('First month').fill('2025-11');
  await activity.getByLabel('Last month').fill('2026-02');
  await expect(activity.getByTestId('activity-months').getByRole('listitem')).toHaveCount(4);
  await expect(activity.getByTestId('activity-months')).toContainText('Nov2025');
  await expect(activity.getByTestId('activity-months')).toContainText('Jan2026');
  await page.screenshot({ path: test.info().outputPath('charts.png') });

  // IP-F11: the search is in the address; Invoice Templates opens with Back to it.
  await page.getByLabel('Search invoices').fill('0098');
  await expect(page).toHaveURL(/[?&]q=0098/);
  await page.getByRole('link', { name: 'Invoice Templates' }).click();
  await page.waitForURL(/\/templates/);
  await page.getByTestId('back-to-origin').click();
  await page.waitForURL(/\/invoices\?.*q=0098/);
  await expect(page.getByLabel('Search invoices')).toHaveValue('0098');
  await expect(page.getByRole('button', { name: 'Actions for INV-2026-0098' })).toBeVisible();
});

test('Recurring Invoices: figures, tabs and a schedule page; Send Now, Pause, Resume, End asking first, and Auto-send (IP-F18)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/recurring'));
  const list = page.getByTestId('recurring-invoices');
  await expect(page.getByTestId('card-active')).toContainText('1');
  await expect(page.getByTestId('card-paused')).toContainText('1');
  await list.getByRole('tab', { name: /Paused/ }).click();
  await expect(list.getByRole('row', { name: /Quarterly payroll review/ })).toBeVisible();
  await expect(list.getByRole('row', { name: /Monthly bookkeeping/ })).toHaveCount(0);
  await list.getByRole('tab', { name: /All/ }).click();
  await page.screenshot({ path: test.info().outputPath('recurring-list.png') });
  await list.getByRole('link', { name: 'Monthly bookkeeping' }).click();
  await page.waitForURL(/\/invoices\/recurring\/[0-9a-f-]{36}$/);
  const detail = page.getByTestId('recurring-detail');
  await expect(detail.getByTestId('recurring-upcoming').getByRole('listitem')).toHaveCount(3);
  await expect(detail.getByTestId('recurring-facts')).toContainText('America/New_York');
  await expect(detail.getByTestId('autopay-note')).toContainText('AutoPay is off');
  await detail.getByRole('switch', { name: 'Auto-send' }).click();
  await expect(page.getByText('Auto-send is on.')).toBeVisible();
  // Send Now asks first, then makes and sends the next one.
  await detail.getByRole('button', { name: 'Send Now' }).click();
  await expect(page.getByTestId('send-now-confirm')).toContainText('sent to');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Now' }).click();
  await expect(page.getByText('The next invoice was made and sent to the client.')).toBeVisible();
  await expect(detail.getByTestId('recurring-invoices-made')).toContainText('INV-2026-R4');
  await detail.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused: no invoice is made until it resumes.')).toBeVisible();
  await expect(detail).toContainText('None while paused.');
  await detail.getByRole('button', { name: 'Resume' }).click();
  await expect(detail.getByTestId('recurring-upcoming')).toBeVisible();
  await detail.getByRole('button', { name: 'End', exact: true }).click();
  await expect(page.getByTestId('end-confirm')).toContainText('makes no more invoices');
  await page.screenshot({ path: test.info().outputPath('recurring-end.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'End Recurring Invoice' }).click();
  await expect(page.getByText('Ended: no more invoices are made.')).toBeVisible();
  await expect(detail.getByTestId('recurring-history')).toContainText('Ended');
  await expect(detail.getByRole('button', { name: 'Resume' })).toHaveCount(0);
});

test('Row menu by status: Resend and Copy Payment Link while unpaid, Send Receipt and Issue Refund once paid (IP-F10)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const search = page.getByLabel('Search invoices');
  await search.fill('0098');
  const menuOf = (n: string) => page.getByRole('button', { name: `Actions for ${n}` }).click();
  await menuOf('INV-2026-0098');
  await expect(page.getByRole('menuitem', { name: 'Send Invoice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Send Receipt' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('row-menu-open.png') });
  await page.getByRole('menuitem', { name: 'Copy Payment Link' }).click();
  await expect(
    page.getByText('Payment link for INV-2026-0098 copied.', { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/invoices\/[0-9a-f-]{36}$/,
  );
  await menuOf('INV-2026-0098');
  await page.getByRole('menuitem', { name: 'Resend Invoice' }).click();
  await expect(page.getByText('INV-2026-0098 sent to the client again.')).toBeVisible();

  // Paid: no resend or link; the receipt and the refund are on the invoice's Payments.
  await search.fill('0081');
  await menuOf('INV-2026-0081');
  await expect(page.getByRole('menuitem', { name: 'Resend Invoice' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Copy Payment Link' })).toHaveCount(0);
  // IP-F10: a paid invoice is never deleted, and is archived once the database allows it.
  for (const name of ['Archive Invoice', 'Delete', 'Delete Draft', 'Delete Invoice']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole('menuitem', { name: 'Issue Refund' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}#payments$/);
  await expect(page.getByTestId('invoice-payments')).toBeVisible();
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

test('The routes from Quick Links: payments, recurring, statement, payment link (IP-F17)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByRole('link', { name: 'View All Payments' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('All Payments');
  await expect(page.getByRole('table', { name: 'Payments' })).toContainText('Check');
  await expect(page.getByRole('table', { name: 'Payments' })).toContainText('Voided');
  await page.getByRole('link', { name: 'Back to Invoices' }).click();

  await page.getByRole('link', { name: 'Recurring Invoices' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Recurring Invoices');
  await expect(page.getByTestId('recurring-cards')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Invoices' }).click();

  await page.getByRole('link', { name: 'Client Statement' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Client Statement');
  await page.getByRole('combobox', { name: 'Client', exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId('statement-totals')).toContainText('Balance due');
  await page.getByRole('link', { name: 'Back to Invoices' }).click();

  await page.getByRole('link', { name: 'Payment Link Generator' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Payment Link Generator');
  await page.getByRole('combobox', { name: 'Invoice', exact: true }).selectOption({ index: 1 });
  await expect(page.getByTestId('payment-link')).toHaveValue(/\/invoices\/[0-9a-f-]{36}$/);
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

test('Archive, never delete: a draft is archived and restored; Delete archives a draft never sent (IP-F10)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const tabs = page.getByRole('tablist', { name: 'Invoice views' });
  const rows = page.getByTestId('invoice-row');
  await expect(tabs.getByRole('tab', { name: /^Archived/ })).toContainText('0');

  const search = page.getByLabel('Search invoices');
  // The overdue invoice is still owed: no Archive.
  await search.fill('0098');
  await page.getByRole('button', { name: 'Actions for INV-2026-0098' }).click();
  await expect(page.getByRole('menuitem', { name: 'Archive Invoice' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The draft: archive it, asked first.
  await search.fill('0107');
  await page.getByRole('button', { name: 'Actions for INV-2026-0107' }).click();
  await page.getByRole('menuitem', { name: 'Archive Invoice' }).click();
  await expect(page.getByTestId('archive-dialog')).toContainText('kept under Archived');
  await page.getByRole('dialog').getByRole('button', { name: 'Archive Invoice' }).click();
  await expect(page.getByText('INV-2026-0107 archived.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for INV-2026-0107' })).toHaveCount(0);
  await tabs.getByRole('tab', { name: /^Archived/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('INV-2026-0107');
  await page.screenshot({ path: test.info().outputPath('invoices-archived.png') });

  // Restore, then Delete it: a draft never sent is archived, never deleted.
  await page.getByRole('button', { name: 'Actions for INV-2026-0107' }).click();
  await page.getByRole('menuitem', { name: 'Restore Invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore Invoice' }).click();
  await expect(page.getByText('INV-2026-0107 restored.')).toBeVisible();
  await expect(rows).toHaveCount(0);
  await tabs.getByRole('tab', { name: /^All Invoices/ }).click();
  await page.getByRole('button', { name: 'Actions for INV-2026-0107' }).click();
  await page.getByRole('menuitem', { name: 'Delete Draft' }).click();
  await expect(page.getByTestId('archive-dialog')).toContainText('invoices are never deleted');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Draft' }).click();
  await expect(page.getByText('INV-2026-0107 deleted: it is kept under Archived.')).toBeVisible();
  await expect(tabs.getByRole('tab', { name: /^Archived/ })).toContainText('1');
});
