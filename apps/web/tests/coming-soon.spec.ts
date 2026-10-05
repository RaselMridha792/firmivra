import { expect, test } from '@playwright/test';

test('public page loads with the planned beta and readable layout', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Firmivra | Coming Soon');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
  await expect(page.getByText('January 8, 2027')).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test('explore link reaches the platform section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore the platform' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#platform$/);
  await expect(
    page.getByRole('heading', { name: 'One platform. Three experiences.' }),
  ).toBeInViewport();
  for (const name of ['Firm Workspace', 'Client Portal', 'Platform Oversight']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
});
