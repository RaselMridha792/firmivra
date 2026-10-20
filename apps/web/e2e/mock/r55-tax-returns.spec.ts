import { expect, test } from '@playwright/test';

// R55: the firm's Tax Returns overview in mock mode (mocks/tax-return-workspace.ts, as an Owner):
// one return dataset with tax-type tabs, KPI cards that filter, the table and its menu, Create New
// Return, Tax Season Progress, Quick Actions and Helpful Links.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the sidebar opens the Tax Returns overview with every widget', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Tax Returns', exact: true })
    .click();
  await expect(page).toHaveURL(app('/tax-returns'));
  await expect(page.getByRole('heading', { name: 'Tax Returns', level: 1 })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Tax types' }).getByRole('tab')).toHaveCount(6);
  await expect(page.getByTestId('tr-kpis').getByRole('listitem')).toHaveCount(7);
  await expect(page.getByTestId('return-link')).toHaveCount(10);
  await expect(page.getByText(/Showing 1\s*[–-]\s*10 of \d+ returns/)).toBeVisible();
  await expect(page.getByTestId('season-progress')).toContainText('Completed');
  await expect(page.getByTestId('quick-actions').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('helpful-links').getByRole('link')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('tabs, KPI cards and filters narrow the same dataset', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await expect(page.getByTestId('return-link').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Quarterly Taxes' }).click();
  await expect(page.getByTestId('return-link')).toHaveCount(4);
  await expect(page.getByRole('table')).toContainText('Quarterly Estimate Q1');
  await page.getByRole('tab', { name: 'Amended Returns' }).click();
  await expect(page.getByTestId('return-link')).toHaveCount(1);
  await page.getByRole('tab', { name: 'All Returns' }).click();
  await page.getByRole('button', { name: 'Show Rejected' }).click();
  await expect(page.getByTestId('tr-filters').getByLabel('Status', { exact: true })).toHaveValue(
    'REJECTED',
  );
  await expect(page.getByRole('table')).toContainText('Rejected');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('tr-filters').getByLabel('Client Type').selectOption('BUSINESS');
  await expect(page.getByRole('table')).not.toContainText('***-**-');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByLabel('Search returns').fill('robin');
  await expect(page.getByTestId('return-link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByLabel('Search returns').fill('no such client');
  await expect(page.getByText('No returns match')).toBeVisible();
});

test('Create New Return opens the new return; a duplicate asks first', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page.getByRole('button', { name: 'Create New Return' }).first().click();
  const dialog = page.getByTestId('create-dialog');
  await dialog.getByLabel('Client').selectOption({ label: 'Jamie Sample' });
  await dialog.getByLabel('Return type').selectOption('1040');
  await dialog.getByLabel('Tax year').fill('2031');
  await page.getByRole('dialog').getByRole('button', { name: 'Create Return' }).click();
  await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('return-workspace')).toContainText('Jamie Sample');
  await page.getByRole('link', { name: 'Back to Returns' }).click();
  await page.getByRole('button', { name: 'Create New Return' }).first().click();
  await dialog.getByLabel('Client').selectOption({ label: 'Jamie Sample' });
  await dialog.getByLabel('Return type').selectOption('1040');
  await dialog.getByLabel('Tax year').fill('2031');
  await page.getByRole('dialog').getByRole('button', { name: 'Create Return' }).click();
  await expect(dialog).toContainText('already has a 2031 1040');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Create Anyway' }),
  ).toBeVisible();
});

test('the row menu changes status (with a reason going back), assigns and archives', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('READY_FOR_REVIEW');
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Change Status' }).click();
  const status = page.getByTestId('status-dialog');
  await status.getByLabel('New status').selectOption('IN_PREPARATION');
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Change Status' });
  await expect(confirm).toBeDisabled();
  await status.getByLabel(/Reason/).fill('The second W-2 changed the totals');
  await confirm.click();
  await expect(page.getByText('Moved to In Preparation.')).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page
    .getByRole('row')
    .nth(1)
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Assign / Reassign Staff' }).click();
  await page
    .getByTestId('assign-dialog')
    .getByLabel('Reviewer')
    .selectOption({ label: 'Adam Admin' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save Assignment' }).click();
  await expect(page.getByText('Assignment saved.')).toBeVisible();

  await page
    .getByRole('row')
    .nth(1)
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Activity / Audit History' }).click();
  await expect(page.getByTestId('activity-drawer')).toContainText('Assignment changed');
  await page.keyboard.press('Escape');

  await page
    .getByRole('row')
    .nth(1)
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Return archived.')).toBeVisible();
});

test('E-File report, import and the empty Ready-to-File blockers', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Generate E-File Reports' })
    .click();
  await expect(page.getByTestId('efile-report')).toContainText('Federal');
  await expect(page.getByTestId('efile-report')).toContainText('IND-031-04');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Import Return' }).first().click();
  await expect(page.getByTestId('import-dialog')).toContainText('No tax-software integration');
});
