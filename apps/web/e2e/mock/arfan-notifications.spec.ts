import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;

test('Super Admin Notifications renders the API states and responsive layouts', async ({
  page,
}) => {
  // The Notifications screen is mock-first and has no platform API contract yet.
  // The mock notifications are dated Oct 1-14, 2026; the screen opens on the last 30 days.
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(`http://admin.localhost:${port}/notifications`);
  await page.addStyleTag({
    content: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });

  await expect(page.getByTestId('page-title')).toHaveText('Notifications');
  const modules = (process.env['PLAYWRIGHT_API_MOCK'] ?? 'all')
    .split(',')
    .map((item) => item.trim());
  const notificationsMocked = modules.includes('all') || modules.includes('adminNotifications');
  const emptyModules = (process.env['PLAYWRIGHT_API_MOCK_EMPTY'] ?? '')
    .split(',')
    .map((item) => item.trim());
  const notificationsEmpty =
    emptyModules.includes('all') || emptyModules.includes('adminNotifications');

  if (!notificationsMocked) {
    await expect(
      page
        .getByRole('heading', { name: 'Notifications are unavailable' })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Try Again' }).filter({ visible: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: 'e2e/screenshots/arfan-notifications/api-unavailable.png',
      fullPage: true,
    });
    return;
  }

  if (notificationsEmpty) {
    await expect(
      page.getByRole('heading', { name: 'No notifications yet' }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByText(/Showing 0.*0 of 0 notifications/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: 'e2e/screenshots/arfan-notifications/empty.png',
      fullPage: true,
    });
    return;
  }

  await expect(page.getByText('124', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment Failed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Showing 1–7 of 124 notifications')).toBeVisible();

  for (const width of [1536, 1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1024 });
    const firstRow =
      width >= 1280
        ? page.locator('table tbody tr').filter({ hasText: 'Payment Failed' })
        : page.locator('article').filter({ hasText: 'Payment Failed' });
    await expect(firstRow).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const filename =
      width === 1536
        ? 'reference-width.png'
        : width === 1440
          ? 'desktop.png'
          : width === 768
            ? 'tablet.png'
            : 'mobile.png';
    await page.screenshot({
      path: `e2e/screenshots/arfan-notifications/${filename}`,
      fullPage: true,
    });
  }

  await page
    .getByRole('searchbox', { name: 'Search notifications, firms, users' })
    .fill('nothing matches this search');
  await expect(
    page.getByText('No notifications match your filters').filter({ visible: true }).first(),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search notifications, firms, users' }).clear();

  await page.getByRole('tab', { name: 'Billing & Subscriptions' }).click();
  await page.getByLabel('Notification priority').selectOption('CRITICAL');
  await expect(page.locator('article').filter({ hasText: 'Payment Failed' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Subscription Renewed' })).toBeHidden();
});
