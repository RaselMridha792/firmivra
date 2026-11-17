// Octavia's Payroll Review 2, F10: the browser's Back button restores the newest list filters.
// Mock mode, as an Owner.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const SEARCH = 'Search clients, business name, or EIN...';

async function openList(page: Page, query = '') {
  await page.goto(`${app}/payroll${query}`);
  await expect(page.getByTestId('client-link').first()).toBeVisible();
}

test('F10: the browser’s Back button brings back the newest filters, each time', async ({
  page,
}) => {
  await openList(page);
  const search = page.getByPlaceholder(SEARCH);
  const period = page.getByLabel('Period', { exact: true });
  await period.selectOption('LAST_MONTH');
  await search.fill('Green');
  await expect(page).toHaveURL(/q=Green/);
  await page.getByTestId('client-link').filter({ hasText: 'Green Leaf' }).click();
  await expect(page).toHaveURL(/\/payroll\/clients\//);
  await page.goBack();
  await expect(search).toHaveValue('Green');
  await expect(period).toHaveValue('LAST_MONTH');

  // Newer filters, away and Back again: the newer ones, never the older.
  await period.selectOption('THIS_YEAR');
  await search.fill('Turner');
  await expect(page).toHaveURL(/q=Turner/);
  await page.getByTestId('client-link').filter({ hasText: 'Turner' }).click();
  await expect(page).toHaveURL(/\/payroll\/clients\//);
  await page.goBack();
  await expect(page).toHaveURL(/period=THIS_YEAR/);
  await expect(search).toHaveValue('Turner');
  await expect(period).toHaveValue('THIS_YEAR');
});
