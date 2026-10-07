import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = `http://admin.localhost:${port}`;
const mockMe = {
  user: {
    id: '00000000-0000-4000-8000-000000000010',
    email: 'morgan.admin@example.test',
    name: 'Morgan Admin',
    pool: 'ADMIN',
  },
  memberships: [],
  clientAccounts: [],
  platformAdmin: true,
};

test('dashboard sign-in check shows loading and can recover from an error', async ({ page }) => {
  let attempts = 0;
  let retryRequested = false;
  await page.route('**/api/v1/admin/me', async (route) => {
    attempts += 1;
    if (!retryRequested) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 500,
        json: { error: { code: 'SERVER_ERROR', message: 'Synthetic test error' } },
      });
      return;
    }
    await route.fulfill({ status: 200, json: mockMe });
  });

  await page.goto(`${admin}/`);
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page.getByText("We couldn't load your account (SERVER_ERROR).")).toBeVisible();
  retryRequested = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Morgan!' })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(2);
});
