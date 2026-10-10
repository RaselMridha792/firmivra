import { expect, test } from '@playwright/test';

// N06 Tax Returns in mock mode (mocks/tax-returns.ts and the year statuses in mocks/clients.ts;
// the payment card uses mocks/invoices.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('tax returns by year and kind, the firm status per year, and the payment card', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/taxes'));
  await expect(page).toHaveTitle('Tax Returns');
  const table = page.getByRole('table', { name: 'Your tax returns' });
  await expect(table).toContainText('2025 Q3');
  await expect(table).toContainText('In Progress');
  await expect(table.getByRole('button', { name: 'Download 2024 Tax Return.pdf' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tax year status' })).toContainText(
    'We are preparing your return.',
  );
  await expect(page.getByText('Payment Due')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('taxes-1440.png'), fullPage: true });

  await page.getByRole('button', { name: /Quarterly Taxes/ }).click();
  await expect(table).toContainText('1040-ES');
  await expect(table).not.toContainText('2024');
  await page.getByRole('button', { name: /Quarterly Taxes/ }).click();

  await page.getByLabel('Tax Year', { exact: true }).selectOption('2023');
  await expect(table).not.toContainText('2025 Q3');
  await expect(table).toContainText('2023');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('taxes-375.png'), fullPage: true });
});
