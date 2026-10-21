import { expect, test } from '@playwright/test';

// R56: opening a notification goes to the record behind it (the notifications spec, §8 and §9).
// In mock mode the two firm application items point at records of mocks/firm-applications.ts;
// a platform notice has no record, so it opens the details panel.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const modules = (process.env['PLAYWRIGHT_API_MOCK'] ?? 'all').split(',');
const emptyModules = (process.env['PLAYWRIGHT_API_MOCK_EMPTY'] ?? '').split(',');
const populated =
  (modules.includes('all') || modules.includes('adminNotifications')) &&
  !emptyModules.includes('all') &&
  !emptyModules.includes('adminNotifications');

test.beforeEach(async ({ page }) => {
  test.skip(!populated, 'Needs the populated notifications mock.');
  // The mock notifications are dated Oct 1-14, 2026; the screen opens on the last 30 days.
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(`http://admin.localhost:${port}/notifications`);
  await expect(page.getByTestId('page-title')).toHaveText('Notifications');
});

test('Review on a firm application notification opens that application', async ({ page }) => {
  await page.getByRole('tab', { name: 'Firm Applications' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Sample Tax Partners LLC' });
  await expect(row).toContainText('Firm Application');
  await row.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page).toHaveURL(/\/applications\/0199b6a2-0000-7000-8000-000000000001$/);
});

test('a platform notice without a record opens the details panel', async ({ page }) => {
  const row = page.getByRole('row').filter({ hasText: 'Platform Update' }).first();
  await row.getByRole('button', { name: 'View Details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Platform Update' })).toBeVisible();
  await expect(page).toHaveURL(/\/notifications$/);
});
