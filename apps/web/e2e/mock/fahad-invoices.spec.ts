import { expect, test } from '@playwright/test';

// Mock mode (playwright.mock.config.ts): every API call is answered in the browser by the mocks,
// so the client's state comes from the mock data, never from page.route.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const client = `${base}/clients/0199b6a1-0000-7000-8000-000000000001/invoices`;
for (const width of [375, 768, 1024, 1440]) {
  test(`invoice list fits ${width}px and status filter works`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(client);
    const list = page.getByTestId(width < 1280 ? 'invoices-cards' : 'invoices-table');
    await expect(list).toContainText('INV-');
    await page.getByTestId('invoice-status-filter').selectOption('PAID');
    await expect(list).toContainText('Paid');
    await expect(list).not.toContainText('Draft');
    // FC-01: every row has Open Invoice, so the open statuses are checked by their own words.
    await expect(list).not.toContainText(/Not Sent|Partially Paid|Overdue|Due Today|Due Soon/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`invoices-${width}.png`), fullPage: true });
  });
}
test('create a multiple-line draft, remove a line and send', async ({ page }) => {
  await page.goto(client);
  await page.getByTestId('invoice-new').click();
  await page.getByTestId('invoice-create').click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.getByLabel('Due date', { exact: true }).fill('2099-10-31');
  await page.getByLabel('Description 1', { exact: true }).fill('Quarterly bookkeeping review');
  await page.getByLabel('Quantity 1', { exact: true }).fill('2');
  await page.getByLabel('Unit price 1 (USD)', { exact: true }).fill('$50');
  await page.getByTestId('invoice-create').click();
  await expect(page.getByText('Enter an amount like 125.50')).toBeVisible();
  await page.getByLabel('Unit price 1 (USD)', { exact: true }).fill('125.50');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await page.getByLabel('Description 2', { exact: true }).fill('Quarterly planning review');
  await page.getByLabel('Unit price 2 (USD)', { exact: true }).fill('50');
  await expect(page.getByTestId('invoice-total')).toHaveText('Total: $301.00');
  await page.getByRole('button', { name: 'Remove line 1', exact: true }).click();
  await expect(page.getByLabel('Unit price 1 (USD)', { exact: true })).toHaveValue('50');
  await page.getByTestId('invoice-create').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = page
    .getByTestId('invoices-table')
    .getByRole('row')
    .filter({ hasText: 'Quarterly planning review' });
  await expect(row).toContainText('$50.00');
  await row.getByTestId('invoice-send').click();
  await expect(row).toContainText('Sent');
});

test('a draft can be cancelled with a required reason', async ({ page }) => {
  await page.goto(client);
  const table = page.getByTestId('invoices-table');
  const button = table.getByTestId('invoice-cancel').first();
  const number = (await button.getAttribute('aria-label'))!.replace('Cancel ', '');
  await button.click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByLabel('Cancellation reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Cancellation reason').fill('Created by mistake.');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: number })).toContainText('Canceled');
});

test('archived client hides creation and Send', async ({ page }) => {
  // Jamie Sample (mock client 1) has a draft: New invoice and its Send show while the client is
  // active. Archived through the mock (its Archive client action, in this page's session), the
  // draft stays listed with no New invoice and no Send.
  await page.goto(client);
  const table = page.getByTestId('invoices-table');
  await expect(table).toContainText('Draft');
  await expect(page.getByTestId('invoice-new')).toBeVisible();
  await expect(table.getByTestId('invoice-send').first()).toBeVisible();

  await page.getByRole('button', { name: 'Archive client' }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive Jamie Sample?' });
  await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(confirm).toBeHidden();

  await expect(page.getByTestId('invoice-new')).toHaveCount(0);
  await expect(page.getByTestId('invoice-send')).toHaveCount(0);
  await expect(table).toContainText('Draft');
  await expect(page.getByTestId('page-title')).toHaveCount(1);
});

test('invalid quantity and past due date keep the draft form open', async ({ page }) => {
  await page.goto(client);
  await page.getByTestId('invoice-new').click();
  await page.getByLabel('Description 1', { exact: true }).fill('Monthly bookkeeping');
  await page.getByLabel('Unit price 1 (USD)', { exact: true }).fill('100');
  await page.getByLabel('Due date', { exact: true }).fill('2099-10-31');
  await page.getByLabel('Quantity 1', { exact: true }).fill('');
  await page.getByTestId('invoice-create').click();
  await expect(page.getByText('Enter a quantity greater than zero')).toBeVisible();
  await page.getByLabel('Quantity 1', { exact: true }).fill('1');
  await page.getByLabel('Due date', { exact: true }).fill('2000-01-01');
  await page.getByTestId('invoice-create').click();
  await expect(page.getByText('Choose today or a future date')).toBeVisible();
  await expect(page.getByTestId('invoice-form')).toBeVisible();
});

test('a newly opened form uses today after the page crosses midnight', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 11, 12) });
  await page.goto(client);
  await page.clock.setSystemTime(new Date(2026, 9, 12, 12));
  await page.getByTestId('invoice-new').click();
  await expect(page.getByLabel('Due date', { exact: true })).toHaveAttribute('min', '2026-10-12');
});
