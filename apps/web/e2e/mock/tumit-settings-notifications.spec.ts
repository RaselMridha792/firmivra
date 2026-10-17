import { expect, test } from '@playwright/test';

// Settings > Notifications (/settings/notifications), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('keeps security notices on and saves an email choice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/notifications`);
  await expect(page).toHaveTitle('Notification settings');
  const account = page.getByLabel('Account and security by email');
  await expect(account).toBeDisabled({ timeout: 60_000 });
  await expect(account).toBeChecked();

  const documents = page.getByLabel('Documents by email');
  await expect(documents).toBeChecked();
  await documents.uncheck();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('notifications-saved')).toHaveText(
    'Notification preferences saved.',
  );
  await expect(page.getByLabel('Documents by email')).not.toBeChecked();
});
