// Super Admin batch 1 (R60): the dashboard's cards and rows open the lists they count, filtered
// the same way; the Firms tabs start on Active and live in the address; Application detail
// resends the owner's invitation. Mock data lives in the tab, so every step navigates in-app.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

/** Opens the dashboard and waits for its figures. */
async function dashboard(page: Page) {
  await page.goto(admin('/'));
  await expect(page.getByTestId('stat-pending-applications-value')).toHaveText('4');
}
/** A Tasks Requiring Attention row's count. */
async function rowCount(page: Page, label: string) {
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: `Open ${label}` }) });
  return Number(await row.locator('span.font-semibold').innerText());
}

test('SA-RPT-Y1d: support report durations show hours and minutes', async ({ page }) => {
  await page.route('**/api/v1/admin/reports/support*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: 2, previous: 1 },
        open: 1,
        inProgress: 0,
        closed: { value: 1, previous: 1 },
        avgFirstResponseMinutes: 2,
        avgResolutionHours: 1.5,
        byPriority: [],
        byFirm: [],
        volume: [],
      }),
    }),
  );
  await page.goto(admin('/reports/support'));
  await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
  await expect(page.getByText('0 h 2 m', { exact: true })).toBeVisible();
  await expect(page.getByText('1 h 30 m', { exact: true })).toBeVisible();
});

test('SA-DSH-F02, SA-FRM-F01: Active Firms opens Firms on Active; the tab lives in the address', async ({
  page,
}) => {
  await dashboard(page);
  await page.getByTestId('stat-active-firms').getByRole('link', { name: 'View Firms' }).click();
  await expect(page).toHaveURL(admin('/firms?status=ACTIVE'));
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toHaveText(/^Active \(/);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.last()).toHaveText(/^All Firms \(/);

  await page.getByRole('tab', { name: /^All Firms \(/ }).click();
  await expect(page).toHaveURL(admin('/firms?status=ALL'));
  await page.getByRole('tab', { name: /^Inactive \(/ }).click();
  await expect(page).toHaveURL(admin('/firms?status=INACTIVE'));
  await expect(page.getByRole('row', { name: /Old Example Firm/ })).toBeVisible();

  // With nothing in the address, the list opens on Active.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Firms', exact: true })
    .click();
  await expect(page).toHaveURL(admin('/firms'));
  await expect(page.getByRole('tab', { name: /^Active \(/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('SA-DSH-F03: Total Users opens Reports Users', async ({ page }) => {
  await dashboard(page);
  await page.getByTestId('stat-total-users').getByRole('link', { name: 'View Users' }).click();
  await expect(page).toHaveURL(admin('/reports/users'));
});

test('SA-DSH-F07: the pending row opens Applications on its Pending tab', async ({ page }) => {
  await dashboard(page);
  await page.getByRole('link', { name: 'Open Firm application pending review' }).click();
  await expect(page).toHaveURL(admin('/applications?tab=PENDING_REVIEW'));
  await expect(page.getByRole('tab', { name: /^Pending/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('SA-DSH-F09: Open support tickets opens Support filtered to Open, with the same count', async ({
  page,
}) => {
  await dashboard(page);
  await expect(page.getByRole('link', { name: 'Open Open support tickets' })).toBeVisible();
  const count = await rowCount(page, 'Open support tickets');
  expect(count).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Open Open support tickets' }).click();
  await expect(page).toHaveURL(admin('/support?status=OPEN'));
  await expect(page.getByTestId('active-filters')).toContainText('Status: Open');
  await expect(page.getByTestId('ticket-link')).toHaveCount(Math.min(count, 10));
});

test('SA-DSH-F10: New users this week opens Reports Users from Monday to today', async ({
  page,
}) => {
  await dashboard(page);
  const week = await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    const monday = new Date(`${today}T00:00:00.000Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return `from=${monday.toISOString().slice(0, 10)}&to=${today}`;
  });
  await page.getByRole('link', { name: 'Open New users this week' }).click();
  await expect(page).toHaveURL(admin(`/reports/users?${week}`));
});

test('SA-DSH-F11: Renewals this week opens Subscriptions filtered, with the same count', async ({
  page,
}) => {
  await dashboard(page);
  await expect(page.getByRole('link', { name: 'Open Renewals this week' })).toBeVisible();
  const count = await rowCount(page, 'Renewals this week');
  await page.getByRole('link', { name: 'Open Renewals this week' }).click();
  await expect(page).toHaveURL(admin('/subscriptions?status=RENEWING_THIS_WEEK'));
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('RENEWING_THIS_WEEK');
  await expect(page.getByTestId('open-subscription')).toHaveCount(Math.min(count, 8));
});

test('SA-DSH-F12: Recent Applications shows the last 30 days, and View All keeps the period', async ({
  page,
}) => {
  await dashboard(page);
  const period = page.getByTestId('recent-period');
  await expect(period).toHaveValue('30');
  await expect(page.getByTestId('recent-application')).toHaveCount(5);
  const viewAll = page.getByRole('link', { name: 'View All' });
  await expect(viewAll).toHaveAttribute('href', '/applications?range=30');
  await period.selectOption('7');
  await expect(viewAll).toHaveAttribute('href', '/applications?range=7');
  await viewAll.click();
  await expect(page.getByRole('combobox', { name: 'Filter by date range' })).toHaveValue('7');
});

test('SA-DSH-F13: Platform Settings opens System Settings', async ({ page }) => {
  await dashboard(page);
  await page.getByRole('link', { name: 'Platform Settings' }).click();
  await expect(page).toHaveURL(admin('/system-settings'));
});

test('SA-APP-F10: an approved application resends the owner invitation; a joined owner has none', async ({
  page,
}) => {
  await page.goto(admin('/applications'));
  await page.getByRole('link', { name: 'Open application for Sample Riverside Tax Co' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Sample Riverside Tax Co');
  await page.getByRole('button', { name: 'Resend Owner Invitation' }).click();
  await expect(page.getByTestId('owner-invite-resent')).toContainText(
    'A new activation link was sent to',
  );

  // Example Northside: approved, its owner has joined.
  await page.goto(admin('/applications/0199b6a2-0000-7000-8000-000000000005'));
  await expect(page.getByTestId('page-title')).toHaveText('Example Northside Accounting LLC');
  await expect(page.getByTestId('approved-firm-summary')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend Owner Invitation' })).toHaveCount(0);
});
