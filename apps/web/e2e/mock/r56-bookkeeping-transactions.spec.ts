import { expect, test } from '@playwright/test';

// BK-T01, the structure (Octavia's Oct 25 review): the client's Transactions with views by status
// and their counts, search and filters, the grid's columns, and honest empty states. Mock mode,
// as an Owner (mocks/bookkeeping.ts makes a ledger for each client with an account).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('Transactions: the grid, views with counts, search and filters', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}?tab=transactions`);
  const tab = page.getByTestId('transactions-tab');
  for (const heading of [
    'Date',
    'Payee',
    'Account',
    'Amount',
    'Debit / Credit',
    'Category',
    'Status',
    'Type',
    'Source',
  ]) {
    await expect(tab.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
  }
  const views = tab.getByRole('tablist', { name: 'Transaction views' });
  await expect(views.getByRole('tab', { name: /^All/ })).toContainText('(16)');
  await views.getByRole('tab', { name: /^Uncategorized/ }).click();
  await expect(tab.getByRole('row')).toHaveCount(5);
  await expect(tab.getByRole('cell', { name: 'Uncategorized' }).first()).toBeVisible();

  await views.getByRole('tab', { name: /^All/ }).click();
  await tab.getByLabel('Search').fill('coffee');
  await expect(tab.getByRole('row')).toHaveCount(3);
  await tab.getByLabel('Debit / Credit').selectOption('CREDIT');
  await expect(tab).toContainText('No transactions match');
  await tab.getByRole('button', { name: 'Clear All' }).click();
  await expect(tab.getByRole('row')).toHaveCount(17);

  await tab.getByLabel('From').fill('2026-12-10');
  await tab.getByLabel('To').fill('2026-12-01');
  await expect(tab.getByRole('alert')).toHaveText('The start date is after the end date.');
});
