import { expect, test } from '@playwright/test';

// Settings > Overview (/settings/overview), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the KPIs, Quick Settings and recent activity', async ({ page }) => {
  // The mock invite was sent Oct 12, 2026: "added this month" counts it in October.
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/overview`);
  await expect(page).toHaveTitle('Settings overview');
  // Ten members are not deactivated; one joined this month.
  await expect(page.getByTestId('kpi-staff-users')).toContainText('101');
  await expect(page.getByTestId('kpi-security-alerts')).toContainText('Requires review');
  await expect(page.getByTestId('recent-admin-activity')).toContainText(
    'Branding settings updated',
  );
  // Octavia's review (Oct 18): the firm's own locations replace the platform's companies.
  await expect(page.getByTestId('kpi-active-locations')).toContainText('2');
  await expect(page.getByTestId('location-management')).toContainText('Auburn Office');
  await page.getByRole('link', { name: 'Manage Access' }).click();
  await expect(page).toHaveURL(/\/settings\/users$/, { timeout: 30_000 });
});
