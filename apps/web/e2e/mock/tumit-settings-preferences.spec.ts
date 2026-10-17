import { expect, test } from '@playwright/test';

// Settings > System Preferences (/settings/preferences), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('changes the formats with a live example and saves them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/preferences`);
  await expect(page).toHaveTitle('System preferences');
  const example = page.getByTestId('live-example');
  await expect(example).toContainText('USD 12,345.67', { timeout: 60_000 });

  await page.getByLabel('Number Format').selectOption('1.234,56');
  await page.getByLabel('Currency').selectOption('EUR');
  await page.getByLabel('Date Format').selectOption('YYYY-MM-DD');
  await expect(example).toContainText('EUR 12.345,67');
  await expect(example).toContainText(/\d{4}-\d{2}-\d{2}/);

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('preferences-saved')).toHaveText('Preferences saved.');
  await expect(page.getByLabel('Currency')).toHaveValue('EUR');
});
