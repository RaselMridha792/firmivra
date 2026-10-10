import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const client = `${base}/clients/0199b6a1-0000-7000-8000-000000000001/invoices`;
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/business/clients/0199b6a1-0000-7000-8000-000000000001', (route) =>
    route.fulfill({ json: clientFixtures()[0] }),
  );
});
test('manual invoices preview', async ({ page }) => {
  test.skip(process.env['FAHAD_MANUAL'] !== '1', 'Opt-in manual preview');
  test.setTimeout(0);
  await page.setViewportSize({ width: Number(process.env['FAHAD_WIDTH'] ?? 1440), height: 1000 });
  await page.goto(client);
  await expect(page.getByTestId('invoices-screen')).toBeVisible();
  await page.pause();
});
for (const width of [375, 768, 1024, 1440]) {
  test(`invoice list fits ${width}px and status filter works`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/invoices`);
    const list = page.getByTestId(width < 768 ? 'invoices-cards' : 'invoices-table');
    await expect(list).toContainText('INV-');
    await page.getByTestId('invoice-status-filter').selectOption('PAID');
    await expect(list).toContainText('Paid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`invoices-${width}.png`), fullPage: true });
  });
}
test('create a multiple-line draft, remove a line and send', async ({ page }) => {
  await page.route('**/api/v1/business/clients/0199b6a1-0000-7000-8000-000000000001', (route) =>
    route.fulfill({ json: clientFixtures()[0] }),
  );
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
  await expect(row).toContainText('Open');
});
