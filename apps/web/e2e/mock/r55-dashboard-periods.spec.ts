import { expect, test } from '@playwright/test';

// R55, Octavia's dashboard review of Oct 25: C1 (the global period and the widgets' own), C2
// (Revenue Overview's Month, Quarter, Year and Custom) and K8 (each card against the equivalent
// period before: New, No change, N/A). In mock mode (playwright.mock.config.ts) as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const shots = 'e2e/mock/r55-screenshots/dashboard';
const today = new Date().toISOString().slice(0, 10);

test('the global period drives the first four cards and says which ones it drives', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/`);
  const cards = page.getByTestId('kpi-card');
  await expect(cards.nth(1)).toContainText('vs last month to date');
  await expect(
    page.getByText('Outstanding Invoices and Appointments Today are always as of today'),
  ).toBeVisible();

  const period = page.getByRole('combobox', { name: 'Dashboard period' });
  await expect(period.locator('option')).toHaveText([
    'Today',
    'This Week',
    'This Month',
    'Last Month',
    'This Quarter',
    'This Year',
    'Last Year',
    'Custom',
  ]);
  await period.selectOption('TODAY');
  // Nothing filed yesterday: New; no leads either day: No change.
  await expect(cards.nth(3)).toContainText('Newnone in yesterday');
  await expect(cards.nth(1)).toContainText('No changevs yesterday');
  await page.screenshot({ path: `${shots}/period-today.png` });

  await period.selectOption('LAST_MONTH');
  await expect(cards.nth(0)).toContainText('vs the month before');
});

test('a Custom period applies only a valid pair of dates and explains a bad one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/`);
  await page.getByRole('combobox', { name: 'Dashboard period' }).selectOption('CUSTOM');
  const range = page.getByRole('group', { name: 'Dashboard period: custom dates' });
  await range.getByLabel('From').fill(today);
  const before = new Date(Date.parse(today) - 3 * 86_400_000).toISOString().slice(0, 10);
  await range.getByLabel('To').fill(before);
  await expect(range.getByRole('alert')).toHaveText(
    'The end date must be on or after the start date.',
  );
  await range.getByLabel('From').fill(before);
  await range.getByLabel('To').fill(today);
  await expect(range.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('kpi-card').nth(1)).toContainText('vs the 4 days before');
});

test('Revenue Overview switches between month, quarter, year and Custom, and the pipeline has its own period', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/`);
  const revenue = page.getByRole('region', { name: 'Revenue Overview' });
  const select = revenue.getByRole('combobox', { name: 'Revenue Overview period' });
  await expect(select.locator('option')).toHaveText([
    'This Month',
    'This Quarter',
    'This Year',
    'Custom',
  ]);
  await expect(revenue.locator('rect')).toHaveCount(12);
  await expect(revenue).toContainText('vs last year to date');
  await select.selectOption('MONTH');
  await expect(revenue.locator('rect')).toHaveCount(Number(today.slice(8)));
  await expect(revenue).toContainText('vs last month to date');
  // Service Breakdown follows the same period.
  await expect(
    page.getByRole('region', { name: 'Service Breakdown' }).getByRole('combobox'),
  ).toHaveValue('MONTH');
  await revenue.screenshot({ path: `${shots}/revenue-month.png` });

  const pipeline = page.getByRole('region', { name: 'Client Pipeline' });
  await pipeline
    .getByRole('combobox', { name: 'Client Pipeline period' })
    .selectOption('THIS_YEAR');
  await expect(page.getByTestId('kpi-card').nth(1)).toContainText('vs last month to date');
  await pipeline.screenshot({ path: `${shots}/pipeline-period.png` });
});
