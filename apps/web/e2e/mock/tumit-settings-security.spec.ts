import { expect, test } from '@playwright/test';

// Settings > Security & Access (/settings/security), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the sign-in rules, two-factor status and alerts', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/security`);
  await expect(page).toHaveTitle('Security & access');
  const mfa = page.getByTestId('mfa-policy');
  await expect(mfa).toContainText('Staff with 2FA set up', { timeout: 60_000 });
  await expect(mfa).toContainText('Required');
  await expect(page.getByTestId('password-policy')).toContainText('12 characters');
  await expect(page.getByTestId('security-alerts')).toContainText('to review');
  await expect(page.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
    'href',
    '/modules/integrations',
  );
});
