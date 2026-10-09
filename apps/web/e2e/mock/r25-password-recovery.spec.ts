import { expect, type Page, test } from '@playwright/test';

// Forgot and reset password on the Super Admin and firm sites. The auth calls are real in mock
// mode, so each test answers them with page.route, as the API would.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PASSWORD = 'Synthetic-Pass-2026';

/** Answers POST {path} and records each body sent. */
async function answer(page: Page, path: string, ...replies: { status: number; body: unknown }[]) {
  const bodies: unknown[] = [];
  await page.route(`**/api/v1${path}`, async (route) => {
    bodies.push(route.request().postDataJSON());
    const reply = replies[Math.min(bodies.length, replies.length) - 1]!;
    await route.fulfill({ status: reply.status, json: reply.body });
  });
  return bodies;
}

const OK = { status: 200, body: { ok: true } };

test('forgot password sends the code and says the same for any email', async ({ page }) => {
  const bodies = await answer(page, '/admin/auth/forgot-password', OK);
  await page.goto(admin('/sign-in'));
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(admin('/forgot-password'));
  await expect(page.getByTestId('page-title')).toHaveText('Forgot Password?');

  const email = page.getByLabel('Email Address');
  const send = page.getByRole('button', { name: 'Send Reset Code' });
  await email.fill('not-an-email');
  await send.click();
  await expect(email).toHaveAccessibleDescription(/email/i);
  expect(bodies).toHaveLength(0);

  await email.fill('nobody@example.test');
  await send.click();
  await expect(page.getByTestId('forgot-sent')).toContainText(
    'If an account uses this email, we sent it a 6-digit reset code.',
  );
  expect(bodies).toEqual([{ email: 'nobody@example.test' }]);
  await page.getByRole('link', { name: 'Enter your reset code' }).click();
  await expect(page).toHaveURL(admin('/reset-password'));
});

test('reset password checks the fields, shows a bad code, then resets', async ({ page }) => {
  const bodies = await answer(
    page,
    '/auth/reset-password',
    {
      status: 400,
      body: { error: { code: 'RESET_CODE_INVALID', message: 'Invalid or expired code' } },
    },
    OK,
  );
  await page.goto(app('/reset-password'));
  await expect(page.getByTestId('page-title')).toHaveText('Reset Password');

  const submit = page.getByRole('button', { name: 'Reset Password' });
  await page.getByLabel('Email Address').fill('owner@example.test');
  await page.getByLabel('Reset code').fill('123 456');
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(`${PASSWORD}x`);
  await submit.click();
  await expect(page.getByLabel('Confirm password')).toHaveAccessibleDescription(
    'The passwords do not match',
  );
  expect(bodies).toHaveLength(0);

  await page.getByLabel('Confirm password').fill(PASSWORD);
  await submit.click();
  // The same answer covers a password Cognito refuses, so the text names both.
  await expect(
    page.getByText('That code is not right or has expired, or choose another password.'),
  ).toHaveAttribute('role', 'alert');
  expect(bodies).toEqual([{ email: 'owner@example.test', code: '123456', password: PASSWORD }]);

  // The code is cleared for another try; the rest stays.
  await expect(page.getByLabel('Reset code')).toHaveValue('');
  await page.getByLabel('Reset code').fill('654321');
  await submit.click();
  await expect(page.getByTestId('reset-done')).toContainText('Your password was reset.');
  // Focus moves to the result so screen readers read it, and the URL stays put.
  await expect(page.getByText('Your password was reset.')).toBeFocused();
  await expect(page).toHaveURL(app('/reset-password'));
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
});

test('a rate-limited reset keeps the code for the next try', async ({ page }) => {
  await answer(page, '/admin/auth/reset-password', {
    status: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  });
  await page.goto(admin('/reset-password'));
  await page.getByLabel('Email Address').fill('admin@example.test');
  await page.getByLabel('Reset code').fill('123456');
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(
    page.getByText('Too many attempts. Wait a few minutes and try again.'),
  ).toHaveAttribute('role', 'alert');
  await expect(page.getByLabel('Reset code')).toHaveValue('123456');
});

test('a password that breaks a rule points to the checklist once', async ({ page }) => {
  await page.goto(app('/reset-password'));
  await page.getByLabel('New password').fill('short');
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByLabel('New password')).toHaveAccessibleDescription(
    'Meet every rule below.',
  );
  await expect(page.getByText('At least 12 characters')).toHaveCount(1);
});

test('the firm sign-in shows firm features, the Super Admin one platform features', async ({
  page,
}) => {
  await page.goto(app('/sign-in'));
  await expect(page.getByRole('heading', { name: 'Firm workspace' })).toBeAttached();
  await expect(page.getByText('Serve Clients', { exact: true })).toBeVisible();
  await expect(page.getByText('Manage Firms', { exact: true })).toHaveCount(0);
  await page.goto(admin('/sign-in'));
  await expect(page.getByText('Manage Firms', { exact: true })).toBeVisible();
});

test('both recovery pages fit a 375px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of [app('/forgot-password'), admin('/reset-password')]) {
    await page.goto(url);
    await expect(page.getByTestId('page-title')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(375);
  }
});
