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

test('says the interface stays English and the currency never converts old amounts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/preferences`);
  const language = page.getByLabel('Language & Region');
  await expect(language).toBeVisible({ timeout: 60_000 });
  await expect(language).toHaveAccessibleDescription(
    'Screens, emails and text messages are in English for now. The language you pick is saved but not applied yet.',
  );
  await expect(page.getByLabel('Currency')).toHaveAccessibleDescription(
    'Changing the currency never converts past invoices or payments. They keep their original amounts and currencies.',
  );

  // Each language is named in itself.
  await language.selectOption({ label: 'Español (Estados Unidos)' });
  await expect(language).toHaveValue('es-US');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('preferences-saved')).toHaveText('Preferences saved.');
  await expect(language).toHaveValue('es-US');
});
