import { expect, test } from '@playwright/test';

// Access & Security, Login & Security tab (/team/[id]/security/login), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('checks and saves the security settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/login`);
  await expect(page).toHaveTitle('Staff security: Login & security');
  await expect(page.getByRole('link', { name: 'Login & Security' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('login-authentication')).toContainText('Enabled');

  await page.getByLabel('Specific IP Addresses Only').check();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Use IP addresses or networks like 203.0.113.0/24')).toBeVisible();

  await page.getByLabel('Allowed IP addresses or networks *').fill('203.0.113.0/24');
  await page.getByLabel('Inactivity time').selectOption('60');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('login-saved')).toHaveText('Security settings saved.');

  // The overview reads the saved settings.
  await page.getByRole('link', { name: 'Account Overview' }).click();
  await expect(page.getByTestId('security-settings')).toContainText('60 minutes');
  await expect(page.getByTestId('security-settings')).toContainText('203.0.113.0/24');
});

test('keeps its frames when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security/login`,
  );
  for (const title of ['Sign-in & Authentication', 'Recovery & Notifications']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
});
