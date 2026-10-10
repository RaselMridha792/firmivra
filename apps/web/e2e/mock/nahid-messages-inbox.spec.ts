import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner sees every client conversation, unread first, and finds a client', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await expect(page.getByTestId('page-title')).toHaveText('Messages');
  const rows = page.getByRole('table', { name: 'Client messages' }).locator('tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('unread');
  await expect(rows.nth(1)).toContainText('unread');
  await expect(rows.nth(2)).not.toContainText('unread');

  await page.getByLabel('Search by client name').fill('riley');
  await expect(rows).toHaveCount(1);
  await rows.getByRole('link', { name: 'Riley Example' }).click();
  await expect(page).toHaveURL(app('/clients/0199b6a1-0000-7000-8000-000000000003/messages'));

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages'));
  await expect(rows.first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
