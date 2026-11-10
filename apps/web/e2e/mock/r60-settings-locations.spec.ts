import { expect, test, type Page } from '@playwright/test';

// R60, Settings > Locations (Octavia's settings review of Oct 20: P0 and the Locations module;
// guide docs/specs/settings-review-2026-10-20/locations--*.md). The list with its KPI cards,
// filters, three-dot menu, details and activity; the Location Profile; Add New Location (required
// fields, several blocks a day, services from Services & Pricing, the duplicate rule, unsaved
// changes); Edit Location with Reassign Manager; a scheduled deactivation, then cancelled. Mock
// mode as the Owner (the Super Administrator). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-settings-locations';

test.describe.configure({ timeout: 180_000 });

const row = (page: Page, name: string) =>
  page.getByTestId('location-row').filter({ hasText: name });

async function openList(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/settings/locations'));
  await expect(page.getByTestId('location-row')).toHaveCount(3, { timeout: 60_000 });
}

test('the list, its menu and the Location Profile', async ({ page }) => {
  await openList(page);
  await expect(
    page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Locations' }),
  ).toHaveAttribute('aria-current', 'page');
  const kpis = page.getByTestId('location-kpis');
  await expect(kpis).toContainText('Total Locations3');
  await expect(kpis).toContainText('Active Locations2');
  await expect(kpis).toContainText('2 / 5');
  await expect(row(page, 'Auburn Office')).toContainText('Primary');
  await expect(row(page, 'Virtual Office')).toContainText('Online / Remote');
  await expect(page.getByTestId('location-details')).toContainText('Auburn Office Details');
  await expect(page.getByTestId('location-activity')).toContainText(
    'Location created: Auburn Office',
  );
  await page.screenshot({ path: `${shots}/list.png`, fullPage: true });

  await page.getByRole('button', { name: 'More actions for Lawrenceville Office' }).click();
  for (const item of [
    'View Location Profile',
    'Edit Location',
    'Manage Staff',
    'Set as Primary',
    'Deactivate',
  ]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/menu.png` });
  await page.keyboard.press('Escape');

  await row(page, 'Auburn Office').getByRole('button', { name: 'View', exact: true }).click();
  const profile = page.getByTestId('location-profile');
  await expect(profile).toContainText('Auburn Office');
  // Wednesday has two blocks (a lunch break); the weekend is closed.
  await expect(profile.getByTestId('profile-hours')).toContainText(
    '9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM',
  );
  await expect(profile.getByTestId('profile-hours')).toContainText('SaturdayClosed');
  await expect(profile.getByRole('link', { name: 'auburn@example.test' })).toHaveAttribute(
    'href',
    'mailto:auburn@example.test',
  );
  await expect(profile.getByRole('link', { name: '(555) 123-4567' })).toHaveAttribute(
    'href',
    'tel:+15551234567',
  );
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/profile.png` });
});

test('Add New Location: required fields, hours, the duplicate rule and unsaved changes', async ({
  page,
}) => {
  await openList(page);
  await page.getByTestId('add-location').click();
  await expect(page.getByTestId('page-title')).toHaveText('Add New Location', { timeout: 60_000 });
  await page.getByTestId('save-location').click();
  await expect(page.getByText('Enter a phone number with its country code')).toBeVisible();

  await page.getByLabel('Location Name *').fill('Auburn Office');
  await page.getByLabel('Address Line 1 *').fill('9 Fake Way');
  await page.getByLabel('City *').fill('Duluth');
  await page.getByLabel('State *').selectOption('GA');
  await page.getByLabel('ZIP Code *').fill('30096');
  await page.getByLabel('Office Phone *').fill('(404) 555-0170');
  await page.getByLabel('Office Email *').fill('duluth@example.test');
  await page.getByLabel('Assign Location Manager *').selectOption({ index: 1 });
  // A second block on Monday, and one service.
  await page.getByRole('button', { name: 'Add another Monday block' }).click();
  await page.getByLabel('Monday opens (2)').selectOption('18:00');
  await page.getByLabel('Monday closes (2)').selectOption('20:00');
  await page.getByTestId('services-offered').getByRole('checkbox').first().check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/add.png`, fullPage: true });
  // The same name as a live location: the guide's words.
  await page.getByTestId('save-location').click();
  await expect(page.getByTestId('location-save-error')).toHaveText(
    'This location already exists. Please review the existing location before continuing.',
  );

  // Leaving asks first.
  await page.getByRole('button', { name: 'Back to Locations' }).click();
  await expect(page.getByTestId('unsaved-location')).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing' }).click();

  await page.getByLabel('Location Name *').fill('Duluth Office');
  await page.getByTestId('save-location').click();
  await expect(page.getByText('Location added.')).toBeVisible({ timeout: 60_000 });
  await expect(row(page, 'Duluth Office')).toContainText('Duluth, GA 30096');
  await row(page, 'Duluth Office').getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByTestId('profile-hours')).toContainText(
    '9:00 AM – 5:00 PM, 6:00 PM – 8:00 PM',
  );
});

test('Edit Location with Reassign Manager, and a scheduled deactivation cancelled', async ({
  page,
}) => {
  await openList(page);
  await row(page, 'Lawrenceville Office').getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Edit Location', { timeout: 60_000 });
  await expect(page.getByLabel('EIN')).toHaveValue('••-•••4321');
  await page.getByRole('button', { name: 'Reassign Manager' }).click();
  const reassign = page.getByTestId('reassign-manager-dialog');
  await reassign.getByLabel('New manager').selectOption({ label: 'Olivia Owner' });
  await page.getByRole('button', { name: 'Reassign Now' }).click();
  await expect(page.getByTestId('manager-card')).toContainText('Olivia Owner');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/edit.png`, fullPage: true });

  await page.getByLabel('Location Name *').fill('Lawrenceville Branch');
  await page.getByTestId('save-location').click();
  await expect(page.getByText('Location saved.')).toBeVisible({ timeout: 60_000 });
  await expect(row(page, 'Lawrenceville Branch')).toContainText('Olivia Owner');

  await page.getByRole('button', { name: 'More actions for Lawrenceville Branch' }).click();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const off = page.getByTestId('deactivate-location-dialog');
  await off.getByLabel('Schedule for a later date and time').check();
  await off.getByLabel(/Effective date and time/).fill('2030-01-15T09:00');
  await page.getByRole('button', { name: 'Schedule Deactivation' }).click();
  await expect(page.getByText(/will be deactivated on Jan 15, 2030/)).toBeVisible();
  await expect(row(page, 'Lawrenceville Branch')).toContainText('Change scheduled');
  await expect(row(page, 'Lawrenceville Branch')).toContainText('Active');

  await page.getByRole('button', { name: 'More actions for Lawrenceville Branch' }).click();
  await page.getByRole('menuitem', { name: 'Edit Schedule' }).click();
  await page.getByRole('button', { name: 'Cancel Schedule' }).click();
  await expect(page.getByText('Deactivation cancelled.')).toBeVisible();
  await expect(row(page, 'Lawrenceville Branch')).not.toContainText('Change scheduled');
});
