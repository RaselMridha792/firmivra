import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';

// R55, Clients Review 2 (FC-01 / N8-15): the client profile's Invoices tab shows each invoice's
// total, remaining balance and detailed status together, and Open Invoice opens that invoice.
// Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/v1/business/clients/${JAMIE}`, (route) =>
    route.fulfill({ json: clientFixtures()[0] }),
  );
});

test('the Invoices tab shows total, balance due and status, and Open Invoice opens it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/clients/${JAMIE}/invoices`);
  const table = page.getByTestId('invoices-table');
  await expect(table.getByRole('columnheader', { name: 'Total' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(table.getByRole('columnheader', { name: 'Balance due' })).toBeVisible();
  // A paid invoice owes nothing: its balance is $0.00 beside its total.
  await page.getByTestId('invoice-status-filter').selectOption('PAID');
  const paid = table.getByRole('row').filter({ hasText: 'Paid' }).first();
  await expect(paid).toContainText('$0.00');
  await page.getByTestId('invoice-status-filter').selectOption('');

  const link = table.getByRole('link', { name: /^Open Invoice INV-/ }).first();
  const number = (await link.getAttribute('aria-label'))!.replace('Open Invoice ', '');
  await expect(link).toHaveAttribute('href', /^\/invoices\/[0-9a-f-]{36}/);
  await link.click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByText(number).first()).toBeVisible({ timeout: 60_000 });
});

test('the cards show total and balance due at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${base}/clients/${JAMIE}/invoices`);
  const card = page.getByTestId('invoice-card').first();
  await expect(card).toContainText('Total', { timeout: 60_000 });
  await expect(card).toContainText('Balance due');
  await expect(card.getByRole('link', { name: /^Open Invoice INV-/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
