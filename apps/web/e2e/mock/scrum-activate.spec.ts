import { expect, type Page, test } from '@playwright/test';

// /activate in mock mode (playwright.mock.config.ts): staffAuth's activation calls are the mock in
// mocks/staff-auth.ts, so its synthetic links work without the API.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PASSWORD = 'Synthetic-Pass-2026';

/** A fresh page load each time: the same URL with another fragment would not reload. */
async function open(page: Page, token: string) {
  await page.goto('about:blank');
  await page.goto(app(token ? `/activate#token=${token}` : '/activate'));
}

test('a new person sets a password, then starts authenticator setup', async ({ page }) => {
  await open(page, 'valid-token-0199-new-owner');
  const invitation = page.getByTestId('invitation');
  await expect(invitation).toContainText('LVP Accounting & Taxes');
  await expect(invitation).toContainText('avery.owner@example.test');
  // The token leaves the address bar once the page has read it.
  await expect(page).toHaveURL(app('/activate'));

  const password = page.getByLabel('New password');
  const confirm = page.getByLabel('Confirm password');
  const rule = (text: string) => page.getByRole('listitem').filter({ hasText: text });
  await password.fill('short');
  await expect(rule('12 characters')).toContainText('not yet');
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(password).toHaveAccessibleDescription('At least 12 characters');

  await password.fill(PASSWORD);
  await confirm.fill(`${PASSWORD}x`);
  await expect(rule('not yet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(confirm).toHaveAccessibleDescription('The passwords do not match');

  await confirm.fill(PASSWORD);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(app('/activate'));
});

test('an expired, unknown or missing link gets one neutral answer', async ({ page }) => {
  for (const token of ['expired-token-0199-old-invite', 'unknown-token-0199-never-sent', '']) {
    await open(page, token);
    await expect(page.getByTestId('activation-invalid')).toContainText('not valid');
    const signIn = page.getByRole('link', { name: 'Go to sign in' });
    await expect(signIn).toHaveAttribute('href', '/sign-in');
    await expect(page.getByLabel('New password')).toHaveCount(0);
  }
});

test('someone with a login signs in to accept instead', async ({ page }) => {
  await open(page, 'account-token-0199-has-login');
  await expect(page.getByTestId('page-title')).toHaveText('Join your firm');
  await page.getByRole('button', { name: 'Sign in to accept' }).click();
  await expect(page.getByLabel('Email Address')).toHaveValue('jordan.staff@example.test');
});

test('fits a 375 px phone and works from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, 'valid-token-0199-new-owner');
  await page.getByLabel('New password').focus();
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show passwords' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await expect(page.getByLabel('Confirm password')).toHaveValue(PASSWORD);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
});
