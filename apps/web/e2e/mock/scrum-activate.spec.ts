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
  const submit = page.getByRole('button', { name: 'Activate account' });
  const mismatch = page.getByText('The passwords do not match');
  const rule = (text: string) => page.getByRole('listitem').filter({ hasText: text });
  // Nothing is submitted yet, so only this submit can show the mismatch: it is not sent.
  await password.fill(PASSWORD);
  await confirm.fill(`${PASSWORD}x`);
  await expect(rule('not yet')).toHaveCount(0);
  await expect(mismatch).toHaveCount(0);
  await submit.click();
  await expect(confirm).toHaveAccessibleDescription('The passwords do not match');
  // From then on both fields re-check as they change: matching from either side clears it.
  await password.fill(`${PASSWORD}x`);
  await expect(mismatch).toHaveCount(0);

  await password.fill('short');
  await expect(rule('12 characters')).toContainText('not yet');
  await submit.click();
  await expect(password).toHaveAccessibleDescription('At least 12 characters');

  // The link still works, so neither submit above reached activate.
  await password.fill(PASSWORD);
  await confirm.fill(PASSWORD);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
  await expect(page.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(app('/activate'));
});

test('if setup cannot start after activating, the person signs in to finish', async ({ page }) => {
  await open(page, 'setup-token-0199-times-out');
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Activate account' }).click();
  await expect(page.getByTestId('activation-done')).toContainText('Your account is activated');
  const signIn = page.getByRole('link', { name: 'Go to sign in' });
  await expect(signIn).toHaveAttribute('href', '/sign-in');
  await expect(signIn).toHaveCSS('font-weight', '500');
  await expect(page.getByLabel('New password')).toHaveCount(0);
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
  // Sign-in and accept are real calls in mock mode; the code 000000 passes MFA.
  await page.route('**/api/v1/auth/sign-in', (route) =>
    route.fulfill({ json: { status: 'MFA_REQUIRED', session: 'synthetic-session' } }),
  );
  const failures = [
    { status: 429, json: { error: { code: 'RATE_LIMITED', message: 'Slow down' } } },
    { status: 410, json: { error: { code: 'INVITE_EXPIRED', message: 'Expired' } } },
  ];
  await page.route('**/api/v1/auth/activation/accept', (route) =>
    route.fulfill(failures.shift() ?? { status: 500 }),
  );
  await open(page, 'account-token-0199-has-login');
  await expect(page.getByTestId('page-title')).toHaveText('Join your firm');
  await page.getByRole('button', { name: 'Sign in to accept' }).click();

  // Signing in keeps the invitation in view, with the invited email fixed.
  await expect(page.getByTestId('page-title')).toHaveText('Join your firm');
  await expect(page.getByTestId('invitation')).toContainText('LVP Accounting & Taxes');
  const email = page.getByLabel('Email Address');
  await expect(email).toHaveValue('jordan.staff@example.test');
  await expect(email).not.toBeEditable();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Verify code' }).click();

  // A failed accept is answered here, signed in, without signing in again.
  await expect(page.getByText('Too many attempts')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('join-failed')).toContainText('could not be accepted');
  await expect(page.getByRole('link', { name: 'Go to your workspace' })).toHaveAttribute(
    'href',
    '/',
  );
  await expect(page.getByTestId('sign-in-form')).toHaveCount(0);
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
