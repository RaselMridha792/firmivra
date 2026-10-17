import { expect, test } from '@playwright/test';

// Settings > Data & Backups (/settings/data), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows backups, retention, export, restore and the audit log', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/data`);
  await expect(page).toHaveTitle('Data & backups');
  await expect(page.getByTestId('data-backups')).toContainText('35 days', { timeout: 60_000 });
  await expect(page.getByTestId('data-retention')).toContainText('7 years');
  // High-risk actions without an API are not offered as buttons.
  await expect(page.getByTestId('data-export').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Audit Log' })).toHaveAttribute(
    'href',
    '/audit-log',
  );
});
