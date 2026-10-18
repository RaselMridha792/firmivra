import { expect, test } from '@playwright/test';

// R56: the Compliance & Deadlines module in mock mode (playwright.mock.config.ts runs every module
// on mock data, as an Owner). Deadline 1 ("Q3 Estimated Tax Payment") is overdue and open.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/compliance`;
const FIRST = '0199c0f0-2d00-7000-8000-000000000001';

test('Overview: six cards, seven views, the table and the side widgets', async ({ page }) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Compliance & Deadlines', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('compliance-kpis').getByRole('button')).toHaveCount(6);
  await expect(
    page.getByRole('tablist', { name: 'Compliance views' }).getByRole('tab'),
  ).toHaveCount(7);
  await expect(
    page.getByTestId('deadline-table').getByTestId('deadline-link').first(),
  ).toBeVisible();
  for (const id of [
    'filters',
    'card-calendar',
    'card-types',
    'card-risk',
    'card-quick',
    'card-resources',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('mini-month').getByRole('button').first()).toBeVisible();
});

test('Filters and views: overdue status, By Client, By Type, Calendars, Recurring', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByTestId('kpi-overdue').click();
  await expect(page.getByTestId('deadline-table').locator('[data-overdue]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  const tab = (name: string) => page.getByRole('tab', { name });
  await tab('By Client').click();
  await expect(page.getByTestId('by-client')).toContainText('Taylor Construction LLC');
  await tab('By Type').click();
  await expect(page.getByTestId('by-type')).toBeVisible();
  await tab('Government Calendars').click();
  await expect(page.getByTestId('calendars-view')).toContainText('IRS Tax Calendar');
  await tab('Recurring').click();
  await expect(page.getByTestId('recurring-rows')).toContainText('Monthly Payroll Tax Deposit');
  await tab('Completed').click();
  await expect(page.getByTestId('deadline-table').getByText('Completed').first()).toBeVisible();
});

test('Tax Calendar and Settings open and save', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Tax Calendar' }).click();
  await expect(page.getByTestId('tax-calendar')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-form')).toBeVisible();
  await page.getByLabel('Due Soon (days)').fill('10');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('Add Deadline: checks the fields, saves, and opens the new deadline', async ({ page }) => {
  await page.goto(`${base}/new`);
  await expect(page.getByRole('heading', { name: 'Add Deadline' })).toBeVisible();
  await page.getByTestId('deadline-save').click();
  await expect(page.getByText('Enter the deadline name')).toBeVisible();
  await page.getByLabel('Deadline Name *').fill('Q4 Sales Tax Return');
  await page.getByLabel('Client', { exact: true }).selectOption({ index: 1 });
  await page.locator('#df-due').fill('2027-01-20');
  await expect(page.getByTestId('deadline-summary')).toContainText('Q4 Sales Tax Return');
  await page.getByTestId('deadline-save').click();
  await expect(page).toHaveURL(/\/compliance\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('deadline-title')).toHaveText('Q4 Sales Tax Return');
});

test('Changing a statutory date needs a reason', async ({ page }) => {
  await page.goto(`${base}/${FIRST}/edit`);
  await expect(page.getByLabel('Deadline Name *')).not.toHaveValue('');
  await page.locator('#df-due').fill('2027-02-01');
  await page.getByTestId('deadline-save').click();
  await expect(page.getByText('Give a reason for changing the statutory date')).toBeVisible();
  await page.getByLabel('Reason for changing the statutory date *').fill('IRS disaster relief');
  await page.getByTestId('deadline-save').click();
  await expect(page).toHaveURL(new RegExp(`/compliance/${FIRST}$`));
  await expect(page.getByTestId('detail-dates')).toContainText('IRS disaster relief');
});

test('Detail: complete a deadline, then reopen it', async ({ page }) => {
  await page.goto(`${base}/${FIRST}`);
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Deadline completed.')).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Deadline reopened.')).toBeVisible();
});

test('Bulk: select rows and change the status', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'All Deadlines' }).click();
  const boxes = page.getByTestId('deadline-table').getByRole('checkbox');
  await expect(boxes.nth(1)).toBeVisible();
  await boxes.nth(1).click();
  await boxes.nth(2).click();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('2 deadlines selected');
  await bar.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/\d+ updated/)).toBeVisible();
});

test('Recurring setup: live preview, validation, save', async ({ page }) => {
  await page.goto(`${base}/recurring/new`);
  await expect(page.getByTestId('preview-dates').getByRole('listitem')).toHaveCount(5);
  await page.getByTestId('recurring-save').click();
  await expect(page.getByText('Enter the deadline name')).toBeVisible();
  await page.getByLabel('Deadline Name *').fill('Quarterly Sales Tax');
  await page.getByTestId('recurring-save').click();
  await expect(page.getByTestId('manage-rows')).toContainText('Quarterly Sales Tax');
});

test('Calendars: import a draft, verify, publish; rules and logs', async ({ page }) => {
  await page.goto(`${base}/recurring/new?tab=import`);
  await page.getByLabel('Authority *').fill('Florida Department of State');
  await page.getByLabel('Calendar name *').fill('Florida Annual Report 2027');
  await page.getByLabel('Official source URL *').fill('https://dos.fl.gov/sunbiz/');
  await page.getByLabel('Record 1 name').fill('Annual Report');
  await page.getByLabel('Due date').fill('2027-05-01');
  await page.getByRole('button', { name: 'Preview Import' }).click();
  await expect(page.getByTestId('diff')).toContainText('1 added');
  await page.getByTestId('import-save').click();
  await expect(page.getByTestId('calendar-library')).toContainText('Florida Annual Report 2027');
  const actions = page.getByRole('button', { name: 'Actions for Florida Annual Report 2027' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Verify' }).click();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Publish' }).click();
  await expect(page.getByText('Florida Annual Report 2027 published.')).toBeVisible();
  await page.getByRole('tab', { name: 'Applicability Rules' }).click();
  await expect(page.getByTestId('rules-tab')).toContainText(
    'Partnership and multi-member LLC return',
  );
  await page.getByRole('tab', { name: 'Logs' }).click();
  await expect(page.getByTestId('logs-tab')).toContainText('Published');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', '/new', `/${FIRST}`, `/${FIRST}/edit`, '/recurring/new']) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'overview').toBeLessThanOrEqual(1);
  }
});
