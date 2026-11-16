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
