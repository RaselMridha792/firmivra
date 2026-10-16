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
  const toolbar = page.getByTestId('appointments-toolbar');
  const rows = list.getByRole('row');
  await expect(rows.nth(1)).toBeVisible({ timeout: 60_000 });
  // The right column of the design: the small month, today, Quick Actions and the Pro Tip.
  await expect(page.getByTestId('appointments-mini')).toContainText("Today's Appointments");
  await expect(page.getByTestId('appointment-quick-actions')).toContainText(
    'Manage Appointment Types',
  );
  await expect(page.getByText('Pro Tip:')).toBeVisible();

  await toolbar.getByLabel('Status').selectOption('PENDING');
  await expect(list.getByRole('table')).not.toContainText('Confirmed');
  await toolbar.getByLabel('Status').selectOption('');

  await toolbar.getByLabel('Search appointments').fill('zzz-nobody');
  await expect(list.getByText('No matching appointments')).toBeVisible();
  await toolbar.getByLabel('Search appointments').fill('');
  await expect(list.getByText('No matching appointments')).toHaveCount(0);
  await expect(rows.nth(1)).toBeVisible();
});
