import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the dashboard: counters, recent documents and their filters', async ({ page }) => {
  await page.goto(app('/firm-sign'));
  await expect(page.getByTestId('page-title')).toHaveText('Firm Sign');
  // The mock's counters are the mockup's.
  for (const [key, count] of [
    ['DRAFT', 12],
    ['NEEDS_APPROVAL', 3],
    ['SENT', 18],
    ['COMPLETED', 42],
    ['VOIDED', 0],
  ] as const) {
    await expect(page.getByTestId(`counter-${key}`)).toContainText(String(count));
  }
  const table = page.getByRole('table', { name: 'Recent documents' });
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(
    table.getByRole('link', { name: 'Payroll Authorization', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search documents').fill('Bookkeeping');
  await expect(
    table.getByRole('link', { name: 'Bookkeeping Services Agreement', exact: true }),
  ).toBeVisible();
  await expect(table.getByRole('link', { name: 'Payroll Authorization', exact: true })).toHaveCount(
    0,
  );
  // Every way to start links to its screen.
  const start = page.getByRole('group', { name: 'Start a request' });
  await expect(start.getByRole('link', { name: /Use Template/ })).toHaveAttribute(
    'href',
    '/firm-sign/templates',
  );
  await expect(start.getByRole('link', { name: /New Signature Request/ })).toHaveAttribute(
    'href',
    '/firm-sign/new',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('the dashboard fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/firm-sign'));
  await expect(page.getByTestId('counter-DRAFT')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('a counter opens All requests with its status', async ({ page }) => {
  await page.goto(app('/firm-sign'));
  await page.getByTestId('counter-COMPLETED').click();
  await expect(page).toHaveURL(/\/firm-sign\/requests\?status=COMPLETED$/);
  await expect(page.getByLabel('Status')).toHaveValue('COMPLETED');
});
