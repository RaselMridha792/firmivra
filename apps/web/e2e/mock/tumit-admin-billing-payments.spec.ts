import { expect, test, type Page } from '@playwright/test';

// Super Admin Billing (S01) on the adminBilling mock: Recurring Invoices, Payments, Credit Notes
// and Create Credit Note. The mock config runs NEXT_PUBLIC_API_MOCK=all, which also signs the
// console in as Morgan Admin. Dates in the mock are relative to today, so statuses are stable;
// credit note numbers carry the year, so the tests match them by pattern.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Recurring Invoices lists the schedules by status and pauses one', async ({ page }) => {
  await page.goto(admin('/billing/recurring'));
  await expect(page.getByTestId('page-title')).toHaveText('Recurring Invoices');
  const rows = page.getByTestId('recurring-table').locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('Acme Holdings LLC');
  await expect(rows.first()).toContainText('Premium Plan');
  await expect(page.getByText('Showing 1–8 of 8 recurring invoices')).toBeVisible();

  const statuses = page.getByRole('group', { name: 'Show recurring invoices by status' });
  await statuses.getByRole('button', { name: 'Paused' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Evans Media LLC');
  await statuses.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(8);

  await page.getByRole('button', { name: 'Actions for Acme Holdings LLC, Premium Plan' }).click();
  await page.getByRole('menuitem', { name: 'Pause' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'Premium Plan for Acme Holdings LLC was paused.',
  );
  await expect(
    rows.filter({ hasText: 'Acme Holdings LLC' }).getByTestId('status-badge'),
  ).toHaveText('Paused');
});

test('?create=1 opens the recurring drawer and saves a new schedule', async ({ page }) => {
  await page.goto(admin('/billing/recurring?create=1'));
  const drawer = page.getByRole('dialog', { name: 'Recurring Invoice Details' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Save Schedule' }).click();
  await expect(drawer.getByText('Select a client', { exact: true })).toBeVisible();

  await drawer
    .getByRole('combobox', { name: /^Client/ })
    .selectOption({ label: 'Brown Consulting (Client #1012)' });
  await drawer.getByLabel('Template / Description').fill('Advisory Retainer\nMonthly advisory');
  await drawer.getByRole('textbox', { name: /^Amount/ }).fill('180');
  await drawer.getByRole('button', { name: 'Save Schedule' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'Recurring invoice Advisory Retainer for Brown Consulting was created.',
  );
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/billing\/recurring$/);
  const rows = page.getByTestId('recurring-table').locator('tbody tr');
  await expect(rows).toHaveCount(9);
  await expect(rows.filter({ hasText: 'Advisory Retainer' })).toContainText('$180.00');
});

test('Payments shows totals, filters the list and records a payment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(admin('/billing/payments'));
  await expect(page.getByTestId('page-title')).toHaveText('Payments');
  await expect(page.getByTestId('kpi-total')).toContainText('17 payments');
  await expect(page.getByTestId('kpi-refunds')).toContainText('2 refunds');
  const tabs = page.getByRole('navigation', { name: 'Billing sections' });
  await expect(tabs.getByRole('link', { name: 'Payments' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const rows = page.getByTestId('payment-table').locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1–10 of 19 payments')).toBeVisible();
  // From 1440 px the details panel sits beside the list, as drawn, and nothing scrolls sideways.
  const panel = page.getByTestId('payment-panel');
  await expect(panel.getByTestId('payment-amount')).toBeVisible();
  const [table, side] = await Promise.all([
    page.getByTestId('payment-table').boundingBox(),
    panel.boundingBox(),
  ]);
  expect((side?.x ?? 0) > (table?.x ?? 0) + (table?.width ?? 0) - 1).toBe(true);
  expect(await noSidewaysScroll(page)).toBe(true);

  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption({ label: 'Failed' });
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId('status-badge')).toHaveText('Failed');
  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption({ label: 'All Statuses' });
  await expect(rows).toHaveCount(10);

  await page.getByRole('button', { name: 'Record Payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record Payment' });
  await dialog
    .getByRole('combobox', { name: /^Firm/ })
    .selectOption({ label: 'LVP Accounting & Taxes' });
  await dialog
    .getByRole('combobox', { name: /^Client/ })
    .selectOption({ label: 'Taylor Corporate' });
  await dialog
    .getByRole('combobox', { name: /^Invoice/ })
    .selectOption({ label: 'INV-0019 · $2,450.00 due' });
  await dialog.getByLabel('Payment Amount').fill('450');
  await dialog.getByRole('button', { name: 'Record Payment' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'Payment of $450.00 recorded on INV-0019.',
  );
  await expect(panel).toContainText('Taylor Corporate');
  await expect(panel.getByTestId('payment-amount')).toHaveText('$450.00');

  await panel.getByRole('button', { name: 'View Receipt' }).click();
  const receipt = page.getByRole('dialog', { name: /^Receipt RCPT-/ });
  await expect(receipt.getByTestId('receipt-document')).toContainText('LVP Accounting & Taxes');
  await expect(receipt.getByTestId('receipt-net')).toHaveText('$450.00');
});

test('Credit Notes shows totals and refunds the credit left on a note', async ({ page }) => {
  await page.goto(admin('/billing/credit-notes'));
  await expect(page.getByTestId('page-title')).toHaveText('Credit Notes');
  await expect(page.getByTestId('kpi-count-value')).toHaveText('12');
  await expect(page.getByTestId('kpi-available-value')).toHaveText('$925.00');
  const rows = page.getByTestId('credit-note-table').locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1–10 of 12 credit notes')).toBeVisible();

  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption({ label: 'Available' });
  await expect(rows).toHaveCount(3);
  await rows.filter({ hasText: 'Mitchell Holdings' }).getByRole('button').first().click();
  const drawer = page.getByRole('dialog', { name: 'Credit Note Details' });
  await expect(drawer.getByTestId('credit-note-number')).toHaveText(/^CN-\d{4}-\d{4}$/);
  await expect(drawer.getByTestId('credit-note-remaining')).toHaveText('$200.00');

  await drawer.getByRole('button', { name: 'Refund Remaining Balance' }).click();
  const refund = page.getByRole('dialog', { name: 'Refund Remaining Balance' });
  await refund.getByLabel('Refund Reason').fill('Customer asked for the balance back');
  await refund.getByLabel(/I confirm the refund of \$200\.00/).check();
  await refund.getByRole('button', { name: 'Confirm Refund' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText('A refund of $200.00 was issued');
  await expect(drawer.getByTestId('credit-note-remaining')).toHaveText('$0.00');
  await expect(drawer.getByTestId('status-badge').first()).toHaveText('Refunded');
});

test('Create Credit Note checks the form, totals live and issues the note', async ({ page }) => {
  await page.goto(admin('/billing/credit-notes/new'));
  await expect(page.getByTestId('page-title')).toHaveText('Create Credit Note');
  await page.getByRole('button', { name: 'Issue Credit Note' }).click();
  await expect(page.locator('#credit-customer')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#credit-reason')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Description, line 1')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#credit-customer').selectOption({
    label: 'Brown Consulting (LVP Accounting & Taxes)',
  });
  await page.locator('#credit-reason').selectOption({ label: 'Service issue' });
  await page.getByLabel('Item / Service, line 1').selectOption({ label: 'Consultation (hourly)' });
  await expect(page.getByLabel('Description, line 1')).toHaveValue('Advisory time, billed hourly');
  await page.getByLabel('Quantity, line 1').fill('2');
  await page.getByLabel('Tax, line 1').selectOption({ label: 'Sales Tax (7%)' });
  await expect(page.getByTestId('line-amount')).toHaveText('$250.00');
  await expect(page.getByTestId('credit-total')).toHaveText('$267.50');

  await page.getByRole('button', { name: 'Issue Credit Note' }).click();
  await expect(page).toHaveURL(/\/billing\/credit-notes\?note=0199d1a0-0b04-[\d-]+&saved=issued$/);
  await expect(page.getByTestId('billing-notice')).toContainText('Credit note issued.');
  const drawer = page.getByRole('dialog', { name: 'Credit Note Details' });
  await expect(drawer).toContainText('Brown Consulting');
  await expect(drawer.getByTestId('status-badge').first()).toHaveText('Available');
  await expect(drawer.getByTestId('credit-note-remaining')).toHaveText('$267.50');
});

for (const [name, path, ready] of [
  ['recurring invoices', '/billing/recurring', 'recurring-table'],
  ['payments', '/billing/payments', 'payment-table'],
  ['credit notes', '/billing/credit-notes', 'credit-note-table'],
  ['create credit note', '/billing/credit-notes/new', 'credit-totals'],
] as const) {
  test(`Billing ${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByTestId(ready)).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}
