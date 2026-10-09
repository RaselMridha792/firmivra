import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const firm = (path: string) => `http://app.localhost:${port}${path}`;
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

async function mockAdminSession(page: Page, platformAdmin = true) {
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
        platformAdmin,
      }),
    }),
  );
}

test('reviews and submits a firm application without showing the full EIN', async ({ page }) => {
  await page.goto(firm('/apply'));
  await expect(page.getByTestId('application-form')).toBeVisible();
  await page.getByRole('button', { name: 'Review application' }).click();
  await expect(page.getByText('Enter the legal business name')).toBeVisible();

  await page.getByTestId('business-name').fill('Northstar Demo Tax LLC');
  await page.getByTestId('business-ein').fill('12-3456789');
  await page.getByLabel('Street address').fill('1 Example Way');
  await page.getByLabel('City').fill('Atlanta');
  await page.getByLabel('State (2-letter code)').fill('GA');
  await page.getByLabel('ZIP code').fill('30301');
  await page.getByLabel('Tax Preparation').check();
  await page.getByLabel('Full name').fill('Jordan Sample');
  await page.getByLabel('Email', { exact: true }).fill('jordan@example.test');
  await page.getByLabel('Phone', { exact: true }).fill('+14045550100');
  await page.getByLabel('I accept Firmivra’s terms and privacy notice.').check();
  await page.getByLabel('I certify that the information above is accurate.').check();
  await page.getByRole('button', { name: 'Review application' }).click();

  await expect(page.getByRole('heading', { name: 'Review your application' })).toBeVisible();
  await expect(page.getByTestId('application-review-ein')).toHaveText('•••••6789');
  await expect(page.getByTestId('application-review-ein')).not.toContainText('123456789');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page).toHaveURL(/\/apply\/done$/);
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible();
  await expect(page.getByText(/email the next steps/i)).toBeVisible();
});

test('filters the firms list and stays usable at mobile width', async ({ page }) => {
  await mockAdminSession(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(admin('/firms'));
  await expect(page.getByTestId('page-title')).toHaveText('Firms');
  await expect(page.getByRole('tab', { name: /Active \(/ })).toBeVisible();
  await expect(page.getByTestId('firm-row').first()).toBeVisible();

  await page.getByRole('tab', { name: /Inactive/ }).click();
  await expect(page.getByTestId('firm-row').getByText('Old Example Firm')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search firms' }).fill('no matching firm');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('firms-empty')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});

for (const width of [1440, 1280]) {
  test(`the All Firms table fits at ${width} px`, async ({ page }) => {
    await mockAdminSession(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(admin('/firms'));
    await page.getByRole('tab', { name: /^All Firms \(/ }).click();
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const table = page.locator('table').locator('..');
    await expect
      .poll(() => table.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(0);
  });
}

test('the firm stat cards filter the list, and the table fits at 1280 px', async ({ page }) => {
  await mockAdminSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(admin('/firms'));
  await page.getByRole('button', { name: 'View Inactive' }).click();
  await expect(page.getByRole('tab', { name: /^Inactive \(/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('row', { name: /Old Example Firm/ })).toBeVisible();
  const table = page.locator('table').locator('..');
  await expect
    .poll(() => table.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(0);
});
