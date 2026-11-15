import { expect, test } from '@playwright/test';

// R60, M23 (Messaging Review 2): the bell lists more than five notifications in an area that
// scrolls, with Mark All Read. Opening it still marks the ones it shows as read (Octavia's N2);
// Mark All Read clears every other unread one and is off when nothing is unread. Mock mode.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('M23: the bell scrolls past five notifications and has Mark All Read', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto(app('/'));
  await page.getByRole('button', { name: /^Notifications/ }).click({ timeout: 60_000 });
  const list = page.getByTestId('bell-list');
  await expect(list.locator('a, p').nth(5)).toBeVisible({ timeout: 30_000 });
  const scrolls = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  const markAll = page.getByRole('button', { name: 'Mark All Read' });
  await expect(markAll).toBeVisible();
  // Whatever is still unread once the list settles, Mark All Read clears it, and then it is off.
  await page.waitForTimeout(2_000);
  if (await markAll.isEnabled()) await markAll.click();
  await expect(markAll).toBeDisabled({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveAccessibleName(
    'Notifications',
  );
});
