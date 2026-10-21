import { expect, type Page, test } from '@playwright/test';

// The firm's Clients list (R1, clients/source/clients.jpg) in mock mode as the Owner. The mock
// (src/mocks/clients.ts) has nine current clients and one archived, four services and the team
// mock's people. Newest first: Riley Example, Acme Widgets, Jamie Sample, Morgan Lee, Northwind
// Bakery, Casey Rivera, Harbor Point Dental, Jordan Blake, then Taylor Quinn on page 2.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients');
}
const names = (page: Page) => page.getByTestId('clients-table').getByTestId('client-link');
const row = (page: Page, name: string) =>
  page.getByTestId('clients-table').getByRole('row').filter({ hasText: name });

test('the cards and tabs show the summary, and both filter the list', async ({ page }) => {
  await open(page);
  const kpis = page.getByTestId('kpi-card');
  await expect(kpis).toHaveCount(6);
  await expect(kpis.nth(0)).toContainText(/9\s*Total Clients/);
  await expect(kpis.nth(2)).toContainText(/4\s*Active Clients/);
  await expect(kpis.nth(3)).toContainText(/4\s*Pending Documents/);
  await expect(kpis.nth(4)).toContainText(/3\s*Balances Due/);
  await expect(kpis.nth(5)).toContainText(/1\s*Inactive Clients/);
  // No stage history: no invented trend.
  await expect(kpis.nth(2)).not.toContainText('vs last month');

  const tabs = page.getByRole('tablist', { name: 'Client views' }).getByRole('tab');
  await expect(tabs).toHaveText([
    /All Clients\s*9/,
    /^Active\s*4/,
    /^New\s*1/,
    /Personal Tax\s*5/,
    /Business Tax\s*3/,
    /Bookkeeping\s*3/,
    /Tax Planning\s*3/,
    /Inactive\s*1/,
  ]);
  await expect(names(page)).toHaveCount(8);

  await page.getByRole('tab', { name: /^Active/ }).click();
  await expect(page.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
  await expect(names(page)).toHaveText([
    'Jamie Sample',
    'Morgan Lee',
    'Northwind Bakery LLC (fake)',
    'Jordan Blake',
  ]);
  await page.getByRole('tab', { name: /^Bookkeeping/ }).click();
  await expect(names(page)).toHaveText([
    'Acme Widgets LLC (fake)',
    'Morgan Lee',
    'Northwind Bakery LLC (fake)',
  ]);
  await kpis.nth(5).click();
  await expect(page.getByRole('tab', { name: /^Inactive/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(names(page)).toHaveText(['Taylor Quinn']);
});

test('the filter row sets the list query, and Reset clears it', async ({ page }) => {
  await open(page);
  await page.getByRole('main').getByLabel('Search clients').fill('acme');
  await expect(names(page)).toHaveText(['Acme Widgets LLC (fake)']);
  await expect(row(page, 'Acme Widgets')).toContainText('Business');
  await expect(row(page, 'Acme Widgets')).toContainText('Pending Docs');
  await expect(row(page, 'Acme Widgets')).toContainText('$290.00');
  await page.getByRole('main').getByLabel('Search clients').fill('');

  await page.getByLabel('Service', { exact: true }).selectOption({ label: 'Tax Planning' });
  await expect(page.getByRole('tab', { name: /^Tax Planning/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(names(page)).toHaveText([
    'Jamie Sample',
    'Harbor Point Dental (fake)',
    'Jordan Blake',
  ]);
  await page.getByLabel('Assigned staff member').selectOption({ label: 'Adam Admin' });
  await expect(names(page)).toHaveText(['Harbor Point Dental (fake)']);
  await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Active' });
  await expect(page.getByText('No matching clients')).toBeVisible();
  await page.getByRole('button', { name: 'Reset Filters' }).click();
  await expect(names(page)).toHaveCount(8);

  // Last activity from a day no client has reached: nothing matches.
  await page.getByLabel('Last activity: any time').click();
  await page.getByLabel('From', { exact: true }).fill('2099-01-01');
  await expect(page.getByText('No matching clients')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(names(page)).toHaveCount(8);

  // More Filters: archived clients.
  await page.getByRole('button', { name: 'More Filters' }).click();
  await page.getByLabel('Archived clients').check();
  await page.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(names(page)).toHaveText(['Pat Archived']);
  await expect(row(page, 'Pat Archived')).toContainText('Archived');
});

test('Bulk Actions assigns and archives the selected clients', async ({ page }) => {
  await open(page);
  const bulk = page.getByRole('button', { name: 'Bulk Actions' });
  await expect(bulk).toBeDisabled();

  await row(page, 'Riley Example').getByRole('checkbox').check();
  await row(page, 'Jamie Sample').getByRole('checkbox').check();
  await expect(page.getByText('2 clients selected')).toBeVisible();
  await bulk.click();
  await page.getByRole('menuitem', { name: 'Assign Staff Member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Staff Member' });
  await dialog.getByLabel('Assign to').selectOption({ label: 'Adam Admin' });
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText('2 clients updated.')).toBeVisible();
  await expect(row(page, 'Riley Example')).toContainText('A. Admin');
  await expect(row(page, 'Jamie Sample')).toContainText('A. Admin');

  await row(page, 'Morgan Lee').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: /Archive Clients/ }).click();
  await page
    .getByRole('dialog', { name: 'Archive Clients' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(page.getByText('1 client archived.')).toBeVisible();
  await expect(row(page, 'Morgan Lee')).toHaveCount(0);
  await expect(
    page.getByTestId('clients-table').getByText('Showing 1 – 8 of 8 clients'),
  ).toBeVisible();
  await expect(page.getByTestId('kpi-card').nth(0)).toContainText(/8\s*Total Clients/);
});

test('the pages and "Show n per page" follow the total', async ({ page }) => {
  await open(page);
  await expect(
    page.getByTestId('clients-table').getByText('Showing 1 – 8 of 9 clients'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Page 2' }).click();
  await expect(names(page)).toHaveText(['Taylor Quinn']);
  await expect(
    page.getByTestId('clients-table').getByText('Showing 9 – 9 of 9 clients'),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Pagination' })
    .getByRole('combobox')
    .selectOption('25');
  await expect(names(page)).toHaveCount(9);
  await expect(
    page.getByTestId('clients-table').getByText('Showing 1 – 9 of 9 clients'),
  ).toBeVisible();
});

test('Add New Client creates the client and opens their record', async ({ page }) => {
  await open(page);
  await page.getByTestId('add-client').click();
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByText('Enter a name')).toBeVisible();
  await dialog.getByLabel('Full name').fill('Avery Testcase');
  await dialog.getByLabel('Email (optional)').fill('avery.testcase@example.test');
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  // The record's route may still be compiling in dev.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText('Avery Testcase').first()).toBeVisible();
});

test('the list fits a 375 px screen as cards', async ({ page }) => {
  await open(page, 375);
  await expect(page.getByTestId('client-card')).toHaveCount(8);
  await expect(page.getByTestId('client-card').first()).toContainText('Riley Example');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
