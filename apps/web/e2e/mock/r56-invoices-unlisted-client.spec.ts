import { expect, test } from '@playwright/test';

// R56, Bookkeeping Review Two E01b: Invoices opened for a client with no invoices yet (Terms'
// Payment Schedule View All) names that client in the Client select, with an empty list, never
// All Clients with everyone's invoices. Mock mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const MORGAN = '0199b6a1-0000-7000-8000-000000000005'; // a mock client with no invoices

test('P1-20: the Client select names a chosen client that has no invoices', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(`${app}/invoices?client=${MORGAN}`);
  const select = page.getByLabel('Client', { exact: true });
  await expect(select).toHaveValue(MORGAN, { timeout: 60_000 });
  await expect(select.locator('option:checked')).toHaveText('Morgan Lee');
  await expect(page.getByRole('link', { name: /^INV-/ })).toHaveCount(0);

  // All Clients still lists everyone's invoices.
  await select.selectOption('');
  await expect(page.getByRole('link', { name: /^INV-/ }).first()).toBeVisible();
});
