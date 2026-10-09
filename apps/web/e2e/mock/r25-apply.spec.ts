import { expect, test } from '@playwright/test';

// /welcome and /apply in the Super Admin pages' style. Tumit's tumit-n04 spec covers the flow.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the application form uses the Super Admin wording and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(app('/apply'));
  await expect(page.getByTestId('page-title')).toHaveText('Apply for a Business Account');
  for (const name of [
    'Business Information',
    'Primary Administrator',
    'Account Details',
    'Agreements',
  ]) {
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
  }
  await expect(page.getByLabel('Business Type')).toBeVisible();
  await expect(page.getByLabel('Title / Role')).toBeVisible();
  await expect(page.getByLabel('Requested Start Date')).toHaveAccessibleDescription(
    'Leave blank for as soon as possible.',
  );
  await page.getByRole('button', { name: 'Add Credential' }).click();
  await expect(page.getByLabel('Credential', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await page.getByRole('link', { name: 'Back to Welcome' }).click();
  await expect(page).toHaveURL(app('/welcome'));
});

test('welcome offers sign in, apply and activate', async ({ page }) => {
  await page.goto(app('/welcome'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Your firm, ready for what's next",
  );
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  await expect(page.getByRole('link', { name: 'Start an application' })).toHaveAttribute(
    'href',
    '/apply',
  );
  await expect(page.getByRole('link', { name: 'Activate account' })).toHaveAttribute(
    'href',
    '/activate',
  );
});
