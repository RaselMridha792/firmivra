import { expect, test } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const admin = `http://admin.localhost:${port}`;

test('Super Admin dashboard opens with the signed-in shell and fits a 375 px screen', async ({
  page,
}) => {
  await page.goto(`${admin}/sign-in`);
  await page.getByRole('button', { name: /superadmin@firmivra\.test/i }).click();

  await expect(page).toHaveURL(`${admin}/`);
  await expect(page.getByRole('heading', { name: /^Welcome back,/ })).toBeVisible();
  await expect(page.getByTestId('dashboard-date')).toHaveText(/\w+, \w+ \d{1,2}, \d{4}/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('nav[aria-label="Main"] a[href="/"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('nav[aria-label="Main"] a[href="/applications"]')).toBeVisible();
  await expect(
    page.getByRole('searchbox', { name: 'Search firms, applications, users' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  const pageWidth = await page.locator('body').evaluate((body) => body.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
