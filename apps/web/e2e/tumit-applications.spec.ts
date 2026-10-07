import { expect, test, type Page } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

async function useMockAdmin(page: Page) {
  await page.route('**/api/v1/admin/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'reviewer@example.test',
          name: 'Synthetic Reviewer',
          pool: 'ADMIN',
        },
        memberships: [],
        clientAccounts: [],
        platformAdmin: true,
      }),
    }),
  );
}

test('approves an application in mock mode and refreshes list counts', async ({ page }) => {
  await useMockAdmin(page);
  await page.goto(admin('/applications'));
  await expect(page.getByRole('heading', { name: 'Firm Applications' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pending (7)' })).toBeVisible();

  await page.getByRole('link', { name: 'Open application' }).first().click();
  await expect(page.getByRole('heading', { name: 'Northstar Tax Studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve application' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  await page.goto(admin('/applications'));
  await expect(page.getByRole('tab', { name: 'Pending (6)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approved (5)' })).toBeVisible();
});

test('unknown application ids show not found', async ({ page }) => {
  await useMockAdmin(page);
  await page.goto(admin('/applications/unknown-application'));
  await expect(page.getByText(/this page could not be found/i)).toBeVisible();
});

test('application list fits a 375px viewport without page overflow', async ({ page }) => {
  await useMockAdmin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(admin('/applications'));
  await expect(page.getByRole('heading', { name: 'Firm Applications' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
