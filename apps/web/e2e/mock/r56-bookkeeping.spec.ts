import { expect, test, type Page } from '@playwright/test';

// R56: the Bookkeeping module in mock mode (playwright.mock.config.ts runs every module on mock
// data, as an Owner). Eight bookkeeping clients; Green Leaf Café LLC (QuickBooks, on track) has its
// October period in progress and its earlier months closed.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/bookkeeping`;

const openGreenLeaf = async (page: Page) => {
  await page.goto(base);
  await page.getByRole('link', { name: 'Green Leaf Café LLC' }).click();
  await page.waitForURL(/\/bookkeeping\/clients\//);
  await expect(page.getByTestId('bk-client')).toBeVisible();
};

test('Overview: five KPIs, the two charts, software, tabs and the client list', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Bookkeeping', level: 1 })).toBeVisible();
  await expect(page.getByTestId('bk-kpis').getByRole('listitem')).toHaveCount(5);
  await expect(page.getByTestId('status-chart')).toContainText('Clients');
  await expect(page.getByTestId('monthly-chart')).toContainText('Monthly Income vs. Expenses');
  await expect(page.getByTestId('software')).toContainText('QuickBooks Online');
  await expect(page.getByRole('tablist', { name: 'Client views' }).getByRole('tab')).toHaveCount(7);
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(8);
  await expect(page.getByRole('link', { name: 'View Reports' })).toBeVisible();
});

test('Overview: status tab, search, filters and Clear All', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: /^Overdue/ }).click();
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(1);
  await expect(page.getByTestId('bk-clients')).toContainText('Jordan Services');
  await page.getByRole('tab', { name: 'All Clients' }).click();
  await page.getByTestId('bk-clients').getByLabel('Search clients').fill('turner');
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear All' }).click();
  await page
    .getByTestId('bk-filters')
    .getByLabel('Accounting Software')
    .selectOption({ label: 'Xero' });
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(1);
});

test('Actions menu: update the status, log an activity, pause and resume', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Actions for Davis Consulting' }).click();
  await page.getByRole('menuitem', { name: 'Update Bookkeeping Status' }).click();
  await page.getByRole('dialog').getByLabel('Status').selectOption('ON_TRACK');
  await page.getByRole('dialog').getByRole('button', { name: 'Update Status' }).click();
  await expect(page.getByText('Status updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Davis Consulting' }).click();
  await page.getByRole('menuitem', { name: 'Log Activity' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('What happened')
    .fill('Called about the missing statements');
  await page.getByRole('dialog').getByRole('button', { name: 'Log Activity' }).click();
  await expect(page.getByText('Activity logged.')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Walker Properties' }).click();
  await page.getByRole('menuitem', { name: 'Pause Bookkeeping Service' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Seasonal pause');
  await page.getByRole('dialog').getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused.')).toBeVisible();
});

test('Actions menu: sync now and the sync details', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Actions for Green Leaf Café LLC' }).click();
  await page.getByRole('menuitem', { name: 'Sync Now' }).click();
  await expect(page.getByText('Sync requested.')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Green Leaf Café LLC' }).click();
  await page.getByRole('menuitem', { name: 'View Sync Details' }).click();
  await expect(page.getByTestId('sync-dialog')).toContainText('manual');
});

test('Header: Sync All Clients, Add Client and Connect Accounting Software', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Sync All Clients' }).click();
  await expect(page.getByText(/Sync requested for every connected client/)).toBeVisible();
  await page.getByRole('button', { name: 'Connect Accounting Software' }).click();
  await expect(page.getByRole('dialog')).toContainText('Choose the client');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('link', { name: 'Bookkeeping Settings' }).click();
  await expect(page.getByTestId('bk-settings')).toBeVisible();
});

test('Client workspace: software, period, accounts, shared counts and the tabs', async ({
  page,
}) => {
  await openGreenLeaf(page);
  await expect(page.getByTestId('accounting-software')).toContainText('QuickBooks Online');
  await expect(page.getByTestId('current-period')).toContainText('In Progress');
  await expect(page.getByTestId('accounts')).toContainText('Business Checking');
  await expect(page.getByTestId('shared-tasks')).toContainText('open');
  await expect(page.getByTestId('upcoming-reports')).toContainText('Profit & Loss');
  await expect(page.getByRole('tablist', { name: 'Client views' }).getByRole('tab')).toHaveCount(9);
  await page.getByRole('tab', { name: 'Reports' }).click();
  await expect(page.getByTestId('reports-tab')).toContainText('Profit & Loss');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('Client workspace: sync now, next client arrow and an account is added', async ({ page }) => {
  await openGreenLeaf(page);
  await page.getByRole('button', { name: 'Sync Now' }).click();
  await expect(page.getByText('Sync requested.')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Account name').fill('Payroll Account');
  await page.getByRole('button', { name: 'Add Account' }).click();
  await expect(page.getByText('Account added.')).toBeVisible();
  await expect(page.getByTestId('manage-accounts')).toContainText('Payroll Account');
  await page.getByRole('button', { name: 'Next client' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\//);
});

test('Close: checklist, figures, reconciliation and the review steps', async ({ page }) => {
  await openGreenLeaf(page);
  await page.getByRole('tab', { name: 'Reconciliation' }).click();
  await page.getByTestId('period-link').first().click();
  await expect(page.getByTestId('period-page')).toBeVisible();
  await expect(page.getByTestId('checklist')).toContainText('Categorization complete');
  await page.getByRole('button', { name: 'Mark Ready for Review' }).click();
  await expect(page.getByText('Finish the required checklist steps first.')).toBeVisible();
  await page.getByLabel('Adjustments posted').click();
  await expect(page.getByText('Step done.')).toBeVisible();
  await page.getByRole('button', { name: 'Enter figures' }).click();
  await page.getByRole('dialog').getByLabel('Total income ($)').fill('30000');
  await page.getByRole('dialog').getByLabel('Total expenses ($)').fill('18000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Figures' }).click();
  await expect(page.getByText('Figures saved.')).toBeVisible();
  await expect(page.getByTestId('figures')).toContainText('$12,000');
  await page.getByRole('button', { name: 'Reconcile an Account' }).click();
  await page.getByRole('dialog').getByLabel('Beginning balance ($)').fill('1000');
  await page.getByRole('dialog').getByLabel('Ending balance ($)').fill('1500');
  await page.getByRole('dialog').getByLabel('Cleared balance ($)').fill('1500');
  await expect(page.getByTestId('recon-diff')).toContainText('$0.00');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Progress' }).click();
  await expect(page.getByText('Reconciliation saved.')).toBeVisible();
  await expect(page.getByTestId('reconciliations')).toContainText('In Progress');
});

test('Reports: the firm list, the upcoming tab and the review steps', async ({ page }) => {
  await page.goto(`${base}/reports`);
  await expect(page.getByTestId('bk-reports-page')).toBeVisible();
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(page.getByText('Profit & Loss').first()).toBeVisible();
  await page
    .getByRole('button', { name: /^Actions for Profit & Loss/ })
    .first()
    .click();
  await page.getByRole('menuitem').first().click();
  await expect(page.getByText(/Report started\.|Sent for review\.|Approved\./)).toBeVisible();
});

test('Settings: the checklists and a saved change', async ({ page }) => {
  await page.goto(`${base}/settings`);
  await expect(page.getByLabel('Step 1', { exact: true })).toHaveValue('Categorization complete');
  await page.getByLabel('Close by day of month').fill('12');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});
