import { expect, test } from '@playwright/test';

// Settings > Overview (/settings/overview), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the KPIs, Quick Settings and recent activity', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/overview`);
  await expect(page).toHaveTitle('Settings overview');
  // Ten members are not deactivated; one joined this month.
  await expect(page.getByTestId('kpi-staff-users')).toContainText('101');
  await expect(page.getByTestId('kpi-security-alerts')).toContainText('Review required');
  await expect(page.getByTestId('recent-admin-activity')).toContainText(
    'Branding settings updated',
  );
  // A firm never sees the platform's companies or applications.
  await expect(page.getByText('Company Applications')).toHaveCount(0);
  await page.getByRole('link', { name: 'Manage Access' }).click();
  await expect(page).toHaveURL(/\/settings\/users$/, { timeout: 30_000 });
});
