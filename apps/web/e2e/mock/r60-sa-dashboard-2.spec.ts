// Super Admin Dashboard, batch 2 (R60, Nov 19): the header search finds firms and applications
// (never people) and Enter opens every result (SA-DSH-F01); Platform Growth offers This Week to
// Last Year and a Custom Date Range, each drawn by day, week or month (SA-DSH-F06, Y02). Mock
// mode; mock data lives in the tab, so every step after the first navigates in-app.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const NORTHSIDE = 'Example Northside Accounting LLC';

test('SA-DSH-F01: the header search shows firms and applications by type, and each opens its record', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/'));
  const box = page.getByRole('searchbox', { name: 'Search firms and applications' });
  await box.fill('northside', { timeout: 60_000 });
  const results = page.getByRole('region', { name: 'Search results' });
  const firm = results.getByTestId('search-result').filter({ hasText: 'Firm' }).filter({
    hasText: NORTHSIDE,
  });
  await expect(firm).toBeVisible();
  await expect(
    results.getByTestId('search-result').filter({ hasText: 'Application' }).filter({
      hasText: NORTHSIDE,
    }),
  ).toBeVisible();
  await firm.click();
  await expect(page).toHaveURL(/\/firms\/0199b6a3-0000-7000-8000-000000000005$/);
  await expect(page.getByTestId('page-title')).toHaveText(NORTHSIDE);
});

test('SA-DSH-F01: Enter opens every result, and a status word finds by status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/'));
  const box = page.getByRole('searchbox', { name: 'Search firms and applications' });
  await box.fill('declined', { timeout: 60_000 });
  await box.press('Enter');
  await expect(page).toHaveURL(admin('/search?q=declined'));
  await expect(page.getByTestId('page-title')).toHaveText('Search');
  const applications = page.getByRole('region', { name: 'Applications' });
  await expect(applications.getByRole('heading')).toHaveText(/^Applications \([1-9]\d*\)$/);
  for (const row of await applications.getByTestId('search-result').all()) {
    await expect(row).toContainText('Declined');
  }
  await expect(page.getByRole('region', { name: 'Firms' })).toContainText('No firms match.');
});

test('SA-DSH-F06: Platform Growth offers the nine ranges and Custom, each with its own points', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(admin('/'));
  const range = page.getByLabel('Range');
  await expect(range).toHaveValue('LAST_30', { timeout: 60_000 });
  await expect(range.locator('option')).toHaveText([
    'This Week',
    'Last 7 Days',
    'Last 30 Days',
    'Last 90 Days',
    'Last 6 Months',
    'Last 12 Months',
    'This Year',
    'Last Year',
    'Custom Date Range',
  ]);
  const chart = page.getByTestId('platform-growth-chart');
  await expect(chart).toHaveAttribute('data-bucket', 'DAY');
  await range.selectOption('LAST_90');
  await expect(chart).toHaveAttribute('data-bucket', 'WEEK');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^Last 90 Days, per week: /);
  await range.selectOption('LAST_12_MONTHS');
  await expect(chart).toHaveAttribute('data-bucket', 'MONTH');
  await range.selectOption('THIS_WEEK');
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^This Week, per day: /);

  await range.selectOption('CUSTOM');
  await expect(chart).toHaveCount(0);
  await page.getByLabel('Custom Date Range: From, start date').fill('2026-10-10');
  await page.getByLabel('Custom Date Range: To, end date').fill('2026-10-01');
  await expect(page.getByText('End date is before start date')).toBeVisible();
  await expect(chart).toHaveCount(0);
  await page.getByLabel('Custom Date Range: To, end date').fill('2026-10-20');
  await expect(chart).toHaveAttribute('data-bucket', 'DAY');
  await expect(chart.getByRole('img')).toHaveAttribute(
    'aria-label',
    /^Custom Date Range, per day: /,
  );
});
