import { expect, test } from '@playwright/test';

// N10 Notification Center in mock mode (mocks/notifications.ts: the portal client's items).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('notifications filter, open their page, and mark all read', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/notifications'));
  await expect(page).toHaveTitle('Notifications');
  await expect(page.getByText(/You have \d+ unread\./)).toBeVisible();
  await expect(page.getByRole('link', { name: /^Notifications, \d+ unread$/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('notifications-1440.png'), fullPage: true });

  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByRole('button', { name: /Your firm shared a document/ })).toHaveCount(0);

  await page.getByRole('button', { name: /New document request/ }).click();
  await expect(page).toHaveURL(/\/lvp\/documents$/);
  await page.goBack();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const opened = page.getByRole('button', { name: /New document request/ });
  await expect(opened.getByText('New', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('You are all caught up.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByText('No unread notifications.')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('notifications-375.png'), fullPage: true });
});

test('Recent Activity under the tabs shows the 5 newest and opens their pages', async ({
  page,
}) => {
  await page.goto(portal('/lvp/documents'));
  const recent = page.getByRole('list', { name: 'Recent activity' });
  await expect(recent.getByRole('listitem')).toHaveCount(5);
  await recent.getByRole('link', { name: /New document request/ }).click();
  await expect(page).toHaveURL(/\/lvp\/documents$/);
  await page.getByRole('link', { name: 'View All' }).first().click();
  await expect(page).toHaveURL(/\/lvp\/notifications$/);
});
