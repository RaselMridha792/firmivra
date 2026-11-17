// Octavia's Payroll Review 2, F06: the list's chart, tabs and Status filter agree, the period
// stays, and a list with no match says so. Mock mode, as an Owner.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const SEARCH = 'Search clients, business name, or EIN...';

async function openList(page: Page, query = '') {
  await page.goto(`${app}/payroll${query}`);
  await expect(page.getByTestId('client-link').first()).toBeVisible();
}

test('F06: a search with no match says so, and Clear Filters brings the whole list back', async ({
  page,
}) => {
  await openList(page);
  await page.getByPlaceholder(SEARCH).fill('zz-no-such-client');
  await expect(page.getByText('No clients match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('');
  await expect(page.getByRole('tab', { name: /^All Clients/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('client-link').first()).toBeVisible();
});

test('F06: through the Status filter, the chart and a tab, the period stays and the rows are the status named', async ({
  page,
}) => {
  await openList(page, '?period=LAST_MONTH');
  const period = page.getByLabel('Period', { exact: true });
  const status = page.getByLabel('Status', { exact: true });
  await expect(period).toHaveValue('LAST_MONTH');
  await status.selectOption('ON_HOLD');
  await expect(page.getByRole('table', { name: 'On Hold clients' })).toBeVisible();

  // The chart's Past Due replaces the On Hold filter: one status, the chart's count of rows.
  const legend = page.getByRole('list', { name: 'Filter the client list by payroll status' });
  const pastDue = legend.getByRole('button', { name: /Past Due/ });
  const count = Number((await pastDue.locator('span.font-semibold').textContent()) ?? '0');
  await pastDue.click();
  await expect(page.getByRole('tab', { name: /^Past Due/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(status).toHaveValue('');
  await expect(period).toHaveValue('LAST_MONTH');
  await expect(page.getByTestId('client-link')).toHaveCount(count);
  for (const row of await page
    .getByRole('row')
    .filter({ has: page.getByTestId('client-link') })
    .all()) {
    await expect(row).toContainText('Past Due');
  }

  // Then a tab: its status only, the period still the same.
  await page.getByRole('tab', { name: /^On Track/ }).click();
  await expect(page).toHaveURL(/period=LAST_MONTH/);
  await expect(page).toHaveURL(/tab=ON_TRACK/);
  await expect(period).toHaveValue('LAST_MONTH');
  await expect(status).toHaveValue('');
  for (const row of await page
    .getByRole('row')
    .filter({ has: page.getByTestId('client-link') })
    .all()) {
    await expect(row).toContainText('On Track');
  }
});
