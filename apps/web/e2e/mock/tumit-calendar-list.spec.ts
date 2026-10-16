import { expect, test } from '@playwright/test';

// Appointments > List (/calendar/list), in mock mode (playwright.mock.config.ts), signed in as
// the Owner. The scheduling mock puts appointments around today. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('lists, searches and filters appointments', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/list`);
  await expect(page).toHaveTitle('Appointments: List');
  await expect(page.getByTestId('appointment-kpis')).toContainText('Total Appointments');
  await expect(page.getByRole('link', { name: 'List' })).toHaveAttribute('aria-current', 'page');
  const list = page.getByTestId('appointments-list');
  const rows = list.getByRole('row');
  await expect(rows.nth(1)).toBeVisible({ timeout: 60_000 });

  await list.getByLabel('Status').selectOption('PENDING');
  await expect(list.getByRole('table')).not.toContainText('Confirmed');
  await list.getByLabel('Status').selectOption('');

  await list.getByLabel('Search appointments').fill('zzz-nobody');
  await expect(list.getByText('No matching appointments')).toBeVisible();
  await list.getByLabel('Search appointments').fill('');
  await expect(list.getByText('No matching appointments')).toHaveCount(0);
  await expect(rows.nth(1)).toBeVisible();
});
