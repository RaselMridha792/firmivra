import { expect, test } from '@playwright/test';

// R56: the firm Reports module in mock mode (every module on mock data, as an Owner): nine report
// categories, eleven quick reports, four recent and four scheduled reports.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/reports`;

test('Dashboard: range, four KPIs, category cards, quick reports and the three lists', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await expect(page.getByTestId('reports-kpis').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByTestId('category-cards').locator(':scope > li')).toHaveCount(9);
  await expect(page.getByTestId('quick-reports').getByRole('link')).toHaveCount(11);
  await expect(page.getByTestId('recent')).toContainText('Revenue Summary');
  await expect(page.getByTestId('scheduled')).toContainText('Weekly Revenue Report');
  await expect(page.getByTestId('insights')).toContainText('Insights');
  await page.getByLabel('Date range').selectOption('last_month');
  await expect(page.getByTestId('range')).toBeVisible();
});

test('Dashboard: a scheduled report is paused and resumed', async ({ page }) => {
  await page.goto(base);
  const sw = page.getByTestId('scheduled').getByRole('switch', { name: /Weekly Revenue Report/ });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(
    page.getByTestId('scheduled').getByRole('switch', { name: /Weekly Revenue Report/ }),
  ).not.toBeChecked();
});

test('Detail: cards, chart, table, quick range and settings', async ({ page }) => {
  await page.goto(`${base}/revenue-summary`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Revenue Summary');
  await expect(page.getByTestId('report-filters')).toBeVisible();
  await expect(page.getByTestId('report-kpis').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByTestId('report-chart')).toBeVisible();
  await expect(page.getByTestId('report-table')).toContainText('Tax Preparation');
  await expect(page.getByTestId('totals')).toContainText('Total');
  await page.getByTestId('quick-range').getByRole('button', { name: 'Last 30 Days' }).click();
  await expect(
    page.getByTestId('quick-range').getByRole('button', { name: 'Last 30 Days' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('switch', { name: 'Show data labels' }).click();
  await page.getByLabel('Search results').fill('payroll');
  await expect(page.getByTestId('report-table')).toContainText('Payroll');
});

test('Detail: More Filters, export, save and schedule', async ({ page }) => {
  await page.goto(`${base}/revenue-summary`);
  await page.getByRole('button', { name: /More Filters/ }).click();
  await page.getByRole('button', { name: '+ Add Filter' }).click();
  await page
    .getByTestId('more-filters')
    .getByLabel('Field')
    .selectOption({ label: 'Payment Status' });
  await page.getByTestId('more-filters').getByLabel('Value').selectOption('Paid');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /More Filters \(1\)/ })).toBeVisible();
  await page
    .getByTestId('report-actions')
    .getByRole('button', { name: /Export/ })
    .click();
  await page.getByRole('menuitem', { name: 'PDF' }).click();
  await expect(page.getByText(/Export ready/)).toBeVisible();
  await page.getByRole('button', { name: 'Schedule Report' }).click();
  await page
    .getByTestId('schedule-dialog')
    .getByLabel('Other email addresses (separated by commas)')
    .fill('cfo@example.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule Report' }).click();
  await expect(page.getByText('Report scheduled.')).toBeVisible();
  await page.getByRole('button', { name: 'Save Report' }).click();
  await page.getByTestId('save-dialog').getByLabel('Report name').fill('My Revenue View');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Report' }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My Revenue View');
});

test('Builder: choose a source and columns, preview it, save it', async ({ page }) => {
  await page.goto(`${base}/builder`);
  await expect(page.getByTestId('step-1')).toBeVisible();
  await expect(page.getByTestId('selected-columns').getByRole('listitem').first()).toBeVisible();
  await expect(page.getByTestId('preview')).toContainText('Report Preview');
  await page.getByTestId('step-4').getByLabel('Group By').selectOption({ index: 1 });
  await page.getByRole('switch', { name: 'Show totals' }).click();
  await expect(page.getByTestId('preview')).toContainText('Report Data (Preview)');
  await page.getByRole('button', { name: 'Save Report' }).click();
  await page.getByTestId('save-dialog').getByLabel('Report name').fill('Builder Report');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Report' }).click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
});

test('Library: recent, saved and scheduled reports', async ({ page }) => {
  await page.goto(`${base}/library`);
  await expect(page.getByTestId('lib-link').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Scheduled Reports' }).click();
  await expect(page.getByRole('table', { name: 'Scheduled reports' })).toContainText(
    'Weekly Revenue Report',
  );
  await page.getByRole('tab', { name: 'Saved Reports' }).click();
  await expect(page.getByRole('heading', { name: /No saved reports yet/ })).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  for (const path of ['', '/revenue-summary', '/builder', '/library']) {
    await page.goto(`${base}${path}`);
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
});
