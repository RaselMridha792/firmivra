import { expect, test } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const admin = 'http://admin.localhost:' + port;
const mockMe = {
  user: {
    id: '00000000-0000-4000-8000-000000000010',
    email: 'alex.morgan@example.test',
    name: 'Alex Morgan',
    pool: 'ADMIN',
  },
  memberships: [],
  clientAccounts: [],
  platformAdmin: true,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/admin/me', (route) => route.fulfill({ status: 200, json: mockMe }));
});

test('Super Admin dashboard and navigation fit desktop and 375 px screens', async ({ page }) => {
  await page.goto(admin + '/');
  await expect(page.getByRole('heading', { name: 'Welcome back, Alex!' })).toBeVisible();
  await expect(page.getByTestId('dashboard-date')).toHaveText(/\w+, \w+ \d{1,2}, \d{4}/);
  await expect(page.getByRole('link', { name: 'Review' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Main' });
  await expect(navigation.getByRole('link', { name: 'Firm Applications 1' })).toBeVisible();
  await expect(page.getByTestId('platform-growth')).toContainText('Coming soon');
  await expect(page.getByTestId('system-status')).toContainText('Online');
  await expect(navigation.locator('a[href="/"]')).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByText('Northstar Tax Studio')).toBeVisible();
  const pageWidth = await page.locator('body').evaluate((body) => body.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
