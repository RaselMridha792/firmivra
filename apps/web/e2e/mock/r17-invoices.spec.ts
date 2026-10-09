import { expect, test } from '@playwright/test';

// N09 Receipts & Invoices in mock mode (mocks/invoices.ts: client 1's invoices).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('invoices list current and past, filter, and pay', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/invoices'));
  await expect(page).toHaveTitle('Receipts & Invoices');
  const current = page.getByRole('table', { name: 'Current invoices' });
  const past = page.getByRole('table', { name: 'Past invoices' });
  await expect(current).toContainText('INV-2026-0101');
  await expect(current).toContainText('Due Soon');
  await expect(current).toContainText('Processing');
  await expect(past).toContainText('INV-2026-0081');
  // Never a draft, never another client's invoice.
  await expect(page.getByText('INV-2026-0107')).toHaveCount(0);
  await expect(page.getByText('INV-2026-0104')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('invoices-1440.png'), fullPage: true });

  await page.getByRole('button', { name: 'Pay INV-2026-0101 now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mock data' })).toBeVisible();

  await page.getByLabel('Show').selectOption('PAID');
  await expect(current).toHaveCount(0);
  await expect(past).not.toContainText('Canceled');
  await page.getByLabel('Show').selectOption('ALL');
  await page.getByLabel('Search').fill('0081');
  await expect(page.getByText('INV-2026-0101')).toHaveCount(0);
  await expect(past).toContainText('INV-2026-0081');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('invoices-375.png'), fullPage: true });
});

test('an invoice opens with its lines and a print button', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/invoices'));
  await page.getByRole('link', { name: 'View INV-2026-0012' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invoice INV-2026-0012');
  await expect(page.getByRole('table', { name: 'Invoice lines' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('invoice-detail-1440.png'), fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
});

test('a return from checkout says so', async ({ page }) => {
  await page.goto(portal('/lvp/invoices?checkout=canceled'));
  await expect(page.getByRole('status').filter({ hasText: 'Nothing was charged' })).toBeVisible();
});
