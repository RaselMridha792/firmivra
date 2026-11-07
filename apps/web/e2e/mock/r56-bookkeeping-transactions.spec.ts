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

test('Transactions: categorize, split to the amount, exclude and include, bulk categorize; a transfer needs its other side (BK-T01 engines)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/bookkeeping/clients/${GREEN}?tab=transactions`);
  const tab = page.getByTestId('transactions-tab');
  const views = tab.getByRole('tablist', { name: 'Transaction views' });
  await views.getByRole('tab', { name: /^Uncategorized/ }).click();
  const menu = (n: number) =>
    tab
      .getByRole('button', { name: /^Actions for / })
      .nth(n)
      .click();
  const dialog = page.getByTestId('txn-dialog');

  // Categorize one line.
  await menu(0);
  await page.getByRole('menuitem', { name: 'Categorize' }).click();
  await dialog.getByLabel('Category').selectOption({ label: 'Office Supplies' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Categorized.')).toBeVisible();

  // Split: the parts must add up to the amount before it saves.
  await menu(0);
  await page.getByRole('menuitem', { name: 'Split' }).click();
  await dialog.getByLabel('Part 1 category').selectOption({ label: 'Rent' });
  await dialog.getByLabel('Part 2 category').selectOption({ label: 'Office Supplies' });
  await dialog.getByLabel('Part 1 amount ($)').fill('1');
  await expect(dialog.getByTestId('split-left')).toContainText('left to assign');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save' })).toBeDisabled();
  const subtitle = (await page.getByRole('dialog').textContent()) ?? '';
  const total = Number(/\$([\d,]+\.\d{2})/.exec(subtitle)?.[1]?.replace(/,/g, '') ?? '0');
  await dialog.getByLabel('Part 2 amount ($)').fill((total - 1).toFixed(2));
  await expect(dialog.getByTestId('split-left')).toHaveText('The parts add up to the amount.');
  await page.screenshot({ path: test.info().outputPath('split.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Split in 2 parts.')).toBeVisible();

  // A transfer's other side is on another account: the mock client has one.
  await views.getByRole('tab', { name: /^All/ }).click();
  await menu(0);
  await page.getByRole('menuitem', { name: 'Match Transfer' }).click();
  await expect(dialog.getByTestId('no-candidates')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Exclude with a reason, then Include.
  await menu(0);
  await page.getByRole('menuitem', { name: 'Exclude' }).click();
  await dialog.getByLabel('Why is it left out of the books?').fill('Fake duplicate of the feed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Excluded from the books.')).toBeVisible();
  await views.getByRole('tab', { name: /^Excluded/ }).click();
  await menu(0);
  await page.getByRole('menuitem', { name: 'Include' }).click();
  await expect(page.getByText('Back in the books.')).toBeVisible();

  // Bulk: select two lines and categorize them at once.
  await views.getByRole('tab', { name: /^All/ }).click();
  const boxes = tab.getByRole('checkbox');
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await expect(tab.getByTestId('bulk-bar')).toContainText('2 selected');
  await tab.getByTestId('bulk-bar').getByRole('button', { name: 'Categorize' }).click();
  await dialog.getByLabel('Category').selectOption({ label: 'Rent' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('2 changed.')).toBeVisible();
});

test('Add Note opens in place, internal and on this service (BK-NAV)', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  const notes = page.getByTestId('shared-notes');
  const url = page.url();
  await notes.getByRole('button', { name: 'Add Note' }).click();
  // It opens here, not on the client profile, and says the note is the firm's only.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('internal, firm only');
  expect(page.url()).toBe(url);
  const save = dialog.getByRole('button', { name: 'Save Note' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Note (firm only)').fill('Fake: asked for the March statement');
  await expect(save).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(url);
});

test('A report previews its figures, generates numbered versions and downloads one; a Balance Sheet waits for a statement (BK-RPT)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/bookkeeping/reports`);
  await page.getByRole('button', { name: 'Actions for Profit & Loss' }).first().click();
  await page.getByRole('menuitem', { name: 'Figures & Versions' }).click();
  const dialog = page.getByTestId('figures-dialog');
  await expect(dialog.getByTestId('report-totals')).toHaveText('Net income $9,080.00');
  await expect(dialog).toContainText('not stored until you generate');
  await page.getByRole('dialog').getByRole('button', { name: 'Generate Version' }).click();
  const versions = dialog.getByTestId('report-versions');
  await expect(versions).toContainText('Version 1');
  await expect(versions.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
    'href',
    /\/api\/v1\/business\/bookkeeping\/reports\/[0-9a-f-]{36}\/versions\/1\/csv$/,
  );
  await page.screenshot({ path: test.info().outputPath('report-figures.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Actions for Balance Sheet' }).first().click();
  await page.getByRole('menuitem', { name: 'Figures & Versions' }).click();
  await expect(dialog.getByTestId('report-totals')).toHaveText(
    'Assets $14,080.00 · Liabilities $0.00 · Net assets $14,080.00',
  );
  await expect(dialog.getByTestId('figures-notes')).toContainText('opening balances');
  await expect(dialog.getByTestId('figures-waiting')).toContainText('Business Card');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Generate Version' }),
  ).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('balance-sheet.png') });
});
