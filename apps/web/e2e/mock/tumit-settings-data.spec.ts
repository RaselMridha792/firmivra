import { expect, test } from '@playwright/test';

// Settings > Data & Backups (/settings/data), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows backups, retention, export, restore and the audit log', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/data`);
  await expect(page).toHaveTitle('Data & backups');
  const backups = page.getByTestId('data-backups');
  await expect(backups).toContainText('35 days', { timeout: 60_000 });
  // Octavia's review (Oct 19): monthly restore tests, and the last successful backup and restore
  // test. Nothing records them yet, so no date is shown.
  await expect(backups).toContainText('Every month');
  await expect(backups).not.toContainText('Every quarter');
  for (const row of ['Last successful backup', 'Last successful restore test']) {
    await expect(backups.locator('div', { hasText: row }).last()).toContainText('Not recorded yet');
  }

  const retention = page.getByTestId('data-retention');
  await expect(retention).toContainText('7 years');
  // No promise that records stay after the account closes, or that Firmivra keeps them forever.
  await expect(retention).toContainText('while your firm uses Firmivra');
  await expect(retention).not.toContainText('after an account closes');
  await expect(retention).not.toContainText('Kept permanently');

  // High-risk actions without an API are not offered as buttons, and no card sends the firm to
  // support for something the page could do.
  await expect(page.getByTestId('data-export').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('data-export')).not.toContainText('Support');
  await expect(page.getByTestId('data-restore').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('data-restore').getByRole('link')).toHaveAttribute(
    'href',
    /^mailto:/,
  );
  await expect(page.getByRole('link', { name: 'Open Audit Log' })).toHaveAttribute(
    'href',
    '/audit-log',
  );
});
