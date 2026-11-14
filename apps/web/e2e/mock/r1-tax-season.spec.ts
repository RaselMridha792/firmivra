import { expect, test } from '@playwright/test';

// Dashboard Review 2 "Tax season context" (R1): Tax Season or Off-Season beside the firm's date on
// the dashboard, from the firm's settings; System Preferences sets the two days, both or neither.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('the dashboard shows the configured season beside the firm-local date', async ({ page }) => {
  await page.goto(`${app}/`);
  const season = page.getByTestId('tax-season');
  await expect(season).toContainText('Off-Season');
  await expect(season).toContainText(/Next tax season: Jan 15 – May 15, \d{4}/);
});

test('System Preferences sets the tax season: both days or neither, saved with the time zone', async ({
  page,
}) => {
  await page.goto(`${app}/settings/preferences`);
  const fields = page.getByTestId('tax-season-fields');
  await fields.getByLabel('Tax season starts: month').selectOption('1');
  await fields.getByLabel('Tax season starts: day').selectOption('15');
  // Half a season is refused before saving.
  await expect(fields.getByRole('alert')).toHaveText(
    'Choose both days of the tax season, or neither.',
  );
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('preferences-saved')).toHaveCount(0);
  // February has 28 days here: no season takes Feb 29.
  await fields.getByLabel('Tax season ends: month').selectOption('2');
  await expect(fields.getByLabel('Tax season ends: day').locator('option')).toHaveCount(28);
  await fields.getByLabel('Tax season ends: month').selectOption('4');
  await fields.getByLabel('Tax season ends: day').selectOption('15');
  await expect(fields.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('preferences-saved')).toHaveText('Preferences saved.');
  await expect(fields.getByLabel('Tax season starts: month')).toHaveValue('1');
  await expect(fields.getByLabel('Tax season ends: day')).toHaveValue('15');
});
