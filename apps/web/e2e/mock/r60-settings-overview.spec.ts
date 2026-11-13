import { expect, test } from '@playwright/test';

// R60, Settings > Overview after Octavia's review (Overview guide of Oct 18, items 3 to 5 and 10
// to 13; docs/specs/settings-review-2026-10-20/overview--*.md): Active Locations, Staff Users
// across all locations, Subscription & Locations, Location Management with Locations' own
// actions (View, Edit, Manage Staff, Set as Primary, Activate), and the Location Management quick
// link. Mock mode as the Owner (the Super Administrator). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-settings-overview';

test.describe.configure({ timeout: 180_000 });

test('the KPIs, Location Management and its actions, and the quick link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/overview'));
  const rows = page.getByTestId('overview-location-row');
  await expect(rows).toHaveCount(3, { timeout: 60_000 });

  await expect(page.getByTestId('kpi-active-locations')).toContainText('Active Locations2');
  await expect(page.getByTestId('kpi-staff-users')).toContainText('Across all locations');
  await expect(page.getByTestId('kpi-subscription-locations')).toContainText('2 / 5');
  await expect(page.getByTestId('kpi-subscription-locations')).toContainText('Locations used');
  // The primary location first; the virtual office has no street.
  await expect(rows.first()).toContainText('Auburn Office');
  await expect(rows.first()).toContainText('123 Main St, Auburn, GA');
  await expect(rows.filter({ hasText: 'Virtual Office' })).toContainText('Online / Remote');
  await expect(page.getByRole('link', { name: 'Manage Locations' })).toHaveCount(2);
  for (const [name, href] of [
    ['View All Locations', '/settings/locations'],
    ['Add Location', '/settings/locations/new'],
    ['Manage Users', '/settings/users'],
    ['Manage Plan', '/settings/billing'],
  ] as const) {
    await expect(page.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  await expect(page.getByText('Company Applications')).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/overview.png`, fullPage: true });

  // View opens the Location Profile over the Overview.
  await rows
    .filter({ hasText: 'Auburn Office' })
    .getByRole('button', { name: 'View', exact: true })
    .click();
  await expect(page.getByTestId('location-profile')).toContainText('Auburn Office');
  await page.keyboard.press('Escape');

  // The inactive office: Activate, as on Locations; the count follows.
  await page.getByRole('button', { name: 'More actions for Virtual Office' }).click();
  for (const item of ['View Location Profile', 'Edit Location', 'Manage Staff', 'Activate']) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/menu.png` });
  await page.getByRole('menuitem', { name: 'Activate' }).click();
  await page.getByTestId('activate-location-dialog').waitFor();
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(page.getByText('Virtual Office is active again.')).toBeVisible();
  await expect(page.getByTestId('kpi-active-locations')).toContainText('Active Locations3');
  await expect(page.getByTestId('kpi-subscription-locations')).toContainText('3 / 5');
  await expect(rows.filter({ hasText: 'Virtual Office' })).toContainText('Active');

  // Edit opens the same record in Locations' edit form.
  await rows
    .filter({ hasText: 'Lawrenceville Office' })
    .getByRole('link', { name: 'Edit' })
    .click();
  await expect(page.getByTestId('page-title')).toHaveText('Edit Location', { timeout: 60_000 });
  await expect(page.getByLabel('Location Name *')).toHaveValue('Lawrenceville Office');

  await page.goBack();
  await page.getByRole('link', { name: 'Manage Locations' }).last().click();
  await expect(page).toHaveURL(/\/settings\/locations$/, { timeout: 60_000 });
});
