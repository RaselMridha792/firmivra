import { expect, test, type Page } from '@playwright/test';

// Super Admin Support (S06) on the adminSupport mock: the dashboard with its summary cards, tabs,
// search and the Create New Support Ticket modal; a ticket with its reply editor and status; and
// Support Settings. The mock seeds 26 tickets (3 overdue, 2 waiting on the customer).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('the dashboard shows counts from the tickets and filters by tab and search', async ({
  page,
}) => {
  await page.goto(admin('/support'));
  await expect(page.getByTestId('page-title')).toHaveText('Support');
  await expect(page.getByTestId('kpi-total-value')).toHaveText('26');
  await expect(page.getByTestId('kpi-overdue-value')).toHaveText('3');
  await expect(page.getByTestId('kpi-waiting-value')).toHaveText('2');
  await expect(page.getByTestId('ticket-link')).toHaveCount(10);
  await expect(page.getByText('Showing 1 – 10 of 26 tickets')).toBeVisible();

  await page.getByRole('tab', { name: 'Unassigned' }).click();
  await expect(page.getByTestId('ticket-link')).toHaveCount(3);

  // A summary card filters the list to the same set it counts.
  await page.getByTestId('kpi-overdue').click();
  await expect(page.getByRole('tab', { name: 'Overdue' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ticket-link')).toHaveCount(3);

  await page.getByRole('tab', { name: 'All Tickets' }).click();
  await page.getByRole('searchbox', { name: 'Search tickets' }).fill('invoice');
  await expect(page.getByTestId('ticket-link')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search tickets' }).fill('#1001');
  await expect(page.getByTestId('ticket-link')).toHaveText(['#1001']);
});

test('a new ticket is checked, created and counted', async ({ page }) => {
  await page.goto(admin('/support'));
  await expect(page.getByTestId('kpi-total-value')).toHaveText('26');
  await page.getByRole('button', { name: 'New Support Ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Support Ticket' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Create Ticket' }).click();
  await expect(dialog.getByText('Enter a subject.')).toBeVisible();
  await expect(dialog.getByText('Describe the issue.')).toBeVisible();

  await dialog.getByLabel('Firm').selectOption({ label: 'Sample Riverside Tax Co' });
  await expect(dialog.getByLabel('Contact / User')).not.toHaveValue('');
  await dialog.getByLabel('Subject').fill('Cannot export client list');
  await dialog.getByLabel('Category').selectOption({ label: 'Technical Issue' });
  await dialog.getByLabel('Priority').selectOption({ label: 'High' });
  await dialog.getByLabel('Assign To').selectOption({ label: 'Priya Shah' });
  await dialog.getByLabel('Description').fill('The export button does nothing on the client list.');
  await dialog.getByRole('button', { name: 'Create Ticket' }).click();

  await expect(page.getByTestId('support-result')).toHaveText('Ticket #1002 was created.');
  await expect(page.getByTestId('kpi-total-value')).toHaveText('27');
  await expect(page.getByRole('link', { name: '#1002', exact: true })).toBeVisible();
});

test('a ticket shows its conversation, takes a reply and changes status', async ({ page }) => {
  await page.goto(admin('/support'));
  await page.getByRole('link', { name: '#1001', exact: true }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Ticket #1001');
  await expect(page.getByTestId('ticket-message')).toHaveCount(5);
  await expect(page.getByRole('tab', { name: 'Internal Notes (2)' })).toBeVisible();
  await expect(page.getByTestId('sla-status')).toBeVisible();
  await expect(page.getByTestId('client-firm')).toContainText('Sample Sunrise Tax Group');

  await page.getByLabel('Reply', { exact: true }).fill('Glad it works now. Closing this soon.');
  await page.getByRole('button', { name: 'Send Reply' }).click();
  await expect(page.getByTestId('support-result')).toHaveText('Reply sent to the client.');
  await expect(page.getByTestId('ticket-message')).toHaveCount(6);

  await page.getByTestId('ticket-status').selectOption('IN_PROGRESS');
  await expect(page.getByTestId('support-result')).toHaveText('#1001 is now In Progress.');
  await expect(page.getByTestId('ticket-status')).toHaveValue('IN_PROGRESS');

  await page.getByRole('tab', { name: 'Activity History' }).click();
  await expect(page.getByText('Status changed from Open to In Progress')).toBeVisible();
});

test('Support Settings adds a category and turns it off', async ({ page }) => {
  await page.goto(admin('/support/settings'));
  await expect(page.getByTestId('page-title')).toHaveText('Support Settings');
  const categories = page.getByTestId('settings-categories');
  await expect(categories.getByText('Account Access')).toBeVisible();
  await expect(page.getByTestId('settings-priorities').getByText('2 business days')).toBeVisible();

  await page.getByRole('button', { name: 'Add Category' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Category' });
  await dialog.getByLabel('Category Name').fill('Payroll Questions');
  await dialog.getByRole('button', { name: 'Add Category' }).click();
  await expect(page.getByTestId('support-result')).toHaveText(
    'Category "Payroll Questions" saved.',
  );
  const toggle = categories.getByRole('switch', { name: 'Payroll Questions active' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('the Support pages fit a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(admin('/support'));
  await expect(page.getByTestId('kpi-total-value')).toHaveText('26');
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.getByRole('link', { name: '#1001', exact: true }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Ticket #1001');
  await expect(page.getByTestId('ticket-information')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.goto(admin('/support/settings'));
  await expect(page.getByTestId('settings-categories').getByText('Account Access')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});
