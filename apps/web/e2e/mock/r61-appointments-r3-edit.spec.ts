import { expect, test, type Page } from '@playwright/test';

// R3 (Review 2): editing a timed appointment to all-day, and back to timed, must Save Changes
// and land on the appointment's detail page - not stay on the edit form.
// Synthetic data only, mock mode (playwright.mock.config.ts), signed in as the Owner.
// Nina Fairbanks's appointment is SCHEDULED and in the future, so it is editable.
// Note: the mock data has a staff conflict when this appointment is made all-day (Daniel Okafor
// has a blocked time at 1 PM). The test handles the Owner's Book Anyway override.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const NINA = '0199c0b0-0a10-7000-8000-000000000002';

async function saveWithOverride(page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).click();
  // The mock data has a conflict for this appointment when made all-day (Daniel's blocked 1 PM).
  // Owner can override: wait for the "Reason to book anyway" field and click Book Anyway.
  const anyway = page.getByLabel('Reason to book anyway (Owner or Admin)');
  if (await anyway.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await anyway.fill('R3 test override');
    await page.getByRole('button', { name: 'Book Anyway' }).click();
  }
}

test('R3: Save Changes from Edit navigates to the detail when switching to all-day', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/calendar/${NINA}/edit`));
  await expect(page).toHaveTitle('Edit appointment');
  await expect(page.getByLabel('All Day')).not.toBeChecked();
  await page.getByLabel('All Day').check();
  await expect(page.getByLabel('Start Time *')).toBeDisabled();
  await saveWithOverride(page);
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
  await expect(page.getByTestId('detail-summary')).toContainText('all day');
});

test('R3: Save Changes from Edit navigates to the detail when switching back to timed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/calendar/${NINA}/edit`));
  await page.getByLabel('All Day').check();
  await saveWithOverride(page);
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('All Day').uncheck();
  await page.getByLabel('Start Time *').selectOption('14:00');
  await page.getByLabel('End Time *').selectOption('14:30');
  await saveWithOverride(page);
  await expect(page).toHaveURL(new RegExp(`/calendar/${NINA}$`), { timeout: 30_000 });
  await expect(page.getByTestId('detail-summary')).toContainText('2:00 PM');
});
