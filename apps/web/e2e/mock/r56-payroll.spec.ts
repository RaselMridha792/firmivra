import { expect, test } from '@playwright/test';

// R56: the Payroll module in mock mode (playwright.mock.config.ts runs every module on mock data,
// as an Owner). Payroll client 1 is Green Leaf Café LLC (Gusto, semi-monthly) with run 9 in progress.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/payroll`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';
const RUN = '0199c0f0-9d00-7000-8000-000000000109';

test('Overview: five cards, the charts, seven views and the table', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Payroll', level: 1 })).toBeVisible();
  await expect(page.getByTestId('payroll-kpis').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('tablist', { name: 'Payroll views' }).getByRole('tab')).toHaveCount(
    7,
  );
  await expect(page.getByTestId('client-table').getByTestId('client-link').first()).toBeVisible();
  for (const id of [
    'card-status',
    'card-volume',
    'card-provider-chart',
    'card-providers',
    'card-upcoming',
    'card-resources',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
});

test('Views and filters: Past Due, search, more filters, Clear', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Past Due' }).click();
  await expect(page.getByTestId('client-table')).toContainText('Jordan Services');
  await page.getByRole('tab', { name: 'All Clients' }).click();
  await page
    .getByTestId('payroll-page')
    .getByRole('searchbox', { name: 'Search clients' })
    .fill('smith');
  await expect(page.getByTestId('client-table').getByTestId('client-link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByTestId('more-filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('client-table').getByTestId('client-link').first()).toBeVisible();
  await page.getByLabel('Period').selectOption('THIS_YEAR');
  await expect(page.getByTestId('payroll-kpis')).toBeVisible();
});

test('Actions menu: the design list, a note and a status change', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Actions for Green Leaf Café LLC' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(21);
  await expect(page.getByRole('menuitem', { name: 'Remove Payroll Service' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add Note' }).click();
  await page
    .getByLabel('Internal note (never shown to the client)')
    .fill('Call the owner on Monday.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Note added.')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Green Leaf Café LLC' }).click();
  await page.getByRole('menuitem', { name: 'Update Payroll Status' }).click();
  await page.getByRole('dialog').getByLabel('Status').selectOption('ACTION_REQUIRED');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Status updated.')).toBeVisible();
});

test('Settings save, and a payroll client is added', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Payroll Settings' }).click();
  await page.getByLabel('Remind this many days before a pay date').fill('5');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add Payroll Client' }).first().click();
  await page
    .getByLabel('Client', { exact: true })
    .selectOption({ label: 'Acme Widgets LLC (fake)' });
  await page.getByTestId('add-client-form').getByLabel('Payroll frequency').selectOption('MONTHLY');
  await page.getByRole('button', { name: 'Add Client' }).click();
  await expect(page).toHaveURL(/\/payroll\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('client-title')).toHaveText('Acme Widgets LLC (fake)');
  await expect(page.getByTestId('run-payroll')).toBeDisabled();
});

test('Client workspace: panels, tabs, notes and settings', async ({ page }) => {
  await page.goto(`${base}/clients/${GREEN}`);
  await expect(page.getByTestId('client-title')).toHaveText('Green Leaf Café LLC');
  for (const id of [
    'stat-provider',
    'stat-period',
    'stat-employees',
    'stat-gross',
    'stat-taxes',
    'stat-net',
    'quick-actions',
    'panel-upcoming',
    'panel-latest',
    'panel-tasks',
    'panel-workers',
    'panel-documents',
    'panel-notes',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await tab('Employees').click();
  await expect(page.getByTestId('tab-employees')).toContainText('Marcus Davis');
  await tab('Payroll Runs').click();
  await expect(page.getByTestId('tab-runs')).toContainText('Completed');
  await tab('Tax Filings').click();
  await expect(page.getByTestId('tab-filings')).toContainText('941');
  await tab('Reports').click();
  await expect(page.getByTestId('year-end')).toBeVisible();
  await tab('Notes').click();
  await page.getByLabel('Internal note (never shown to the client)').fill('Bank form received.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(page.getByText('Note added.')).toBeVisible();
  await tab('Settings').click();
  await page.getByLabel('Plan or service').fill('Payroll Plus');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await expect(page.getByTestId('change-history')).toContainText('plan');
});

test('Add an employee from the workspace', async ({ page }) => {
  await page.goto(`${base}/clients/${GREEN}`);
  await page.getByTestId('quick-actions').getByRole('button', { name: 'Add Employee' }).click();
  await page.getByLabel('Name *').fill('Dana Fox');
  await page.getByLabel('Pay rate ($ per hour)').fill('21.5');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Dana Fox added.')).toBeVisible();
});

test('Run Payroll continues the run in progress', async ({ page }) => {
  await page.goto(`${base}/clients/${GREEN}`);
  await page.getByTestId('run-payroll').click();
  await expect(page).toHaveURL(new RegExp(`/payroll/runs/${RUN}$`));
  await expect(page.getByTestId('run-title')).toHaveText('Green Leaf Café LLC');
});

test('Run: edit a line, mark ready, approve, submit and complete', async ({ page }) => {
  await page.goto(`${base}/runs/${RUN}`);
  await expect(page.getByTestId('run-summary')).toBeVisible();
  await page
    .getByRole('button', { name: /^Edit / })
    .first()
    .click();
  await page.getByRole('dialog').getByLabel('Hours').fill('82');
  await page.getByRole('button', { name: 'Save Line' }).click();
  await expect(page.getByText('Line saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Mark Ready for Review' }).click();
  await expect(page.getByText('Marked ready for review.')).toBeVisible();
  await page.getByTestId('approve-run').click();
  await expect(page.getByText('Payroll approved.')).toBeVisible();
  await page.getByTestId('submit-provider').click();
  await page.getByLabel('Provider confirmation').fill('GUSTO-7781');
  await page.getByRole('button', { name: 'Record Submission' }).click();
  await expect(page.getByText('Submitted to the provider.')).toBeVisible();
  await expect(page.getByTestId('provider-confirmation')).toContainText('GUSTO-7781');
  await page.getByTestId('complete-run').click();
  await expect(page.getByText('Payroll completed.')).toBeVisible();
});

test('Run: an unvalidated bank blocks review until the issue is resolved', async ({ page }) => {
  await page.goto(`${base}/runs/${RUN}`);
  await page.getByRole('button', { name: 'Add Employee' }).first().click();
  await page.getByLabel('Name *').fill('Pat Newhire');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(/Pat Newhire added/)).toBeVisible();
  await page.getByRole('button', { name: 'Mark Ready for Review' }).click();
  await expect(page.getByText('Resolve the errors before review.')).toBeVisible();
  await page.getByRole('button', { name: /^Resolve .*bank account/ }).click();
  await page.getByRole('button', { name: 'Mark Ready for Review' }).click();
  await expect(page.getByText('Marked ready for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByLabel('Why is it being reopened?').fill('Missed a bonus');
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Run reopened.')).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', `/clients/${GREEN}`, `/runs/${RUN}`]) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'overview').toBeLessThanOrEqual(1);
  }
});
