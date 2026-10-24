import { expect, test } from '@playwright/test';

// Settings > Notifications (/settings/notifications), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Octavia's review of Oct 18 and Rasel's default of Oct 24: staff email is
// always on, and text messages wait for a verified mobile number. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('email is always on for staff; text messages wait for a verified mobile number', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/notifications`);
  await expect(page).toHaveTitle('Notification settings');
  const account = page.getByLabel('Account and security by email (always on)');
  await expect(account).toBeDisabled({ timeout: 60_000 });
  await expect(account).toBeChecked();

  // Every email box is checked and locked, not only Account and security.
  for (const category of ['Documents', 'Messages and notes', 'Appointments']) {
    const box = page.getByLabel(`${category} by email (always on)`);
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
  }
  await expect(page.getByLabel('Documents by text message')).toBeDisabled();
  const reason = page.getByTestId('sms-unavailable');
  await expect(reason).toContainText('verified mobile number');
  await expect(reason.getByRole('link', { name: 'My Profile' })).toHaveAttribute(
    'href',
    '/profile',
  );
  // Nothing can change, so nothing can be saved.
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
});
