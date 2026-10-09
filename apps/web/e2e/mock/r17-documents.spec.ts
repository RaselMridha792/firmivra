import { expect, test } from '@playwright/test';

// N05 My Uploaded Documents in mock mode (mocks/documents.ts: the client's own uploads).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('My Uploaded Documents lists, filters and searches the client uploads', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/documents'));
  await expect(page).toHaveTitle('My Uploaded Documents');
  await expect(
    page.getByRole('heading', { name: 'My Uploaded Documents', level: 1 }),
  ).toBeVisible();
  const table = page.getByRole('table');
  // A file still being checked has no download yet.
  await expect(table.getByText('Checking…').first()).toBeVisible();
  const rows = await table.getByRole('row').count();
  expect(rows).toBeGreaterThan(2);
  await page.screenshot({ path: testInfo.outputPath('documents-1440.png'), fullPage: true });

  await page.getByLabel('Search').fill('w-2');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('W-2');
  await page.getByLabel('Search').fill('');
  await expect(table.getByRole('row')).toHaveCount(rows);

  const years = page.getByLabel('Year');
  await years.selectOption({ index: 1 });
  const chosen = await years.inputValue();
  await expect(table.getByRole('row').nth(1)).toContainText(chosen);

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('documents-375.png'), fullPage: true });
});
