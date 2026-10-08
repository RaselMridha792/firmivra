import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('portal shell and mobile drawer preserve navigation and session', async ({ page }) => {
  await page.goto(portal('/lvp/documents'));
  await expect(
    page.getByRole('navigation', { name: 'Portal folders' }).getByRole('link'),
  ).toHaveCount(6);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Portal menu' })).toBeVisible();
  await page.getByRole('dialog').getByRole('link', { name: 'My Profile' }).click();
  await expect(page).toHaveURL(portal('/lvp/profile'));
  await expect(page.getByRole('dialog', { name: 'Portal menu' })).not.toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
