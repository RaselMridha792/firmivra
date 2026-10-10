import { expect, test } from '@playwright/test';

// N03 sign-in in mock mode: any password signs in except MOCK_WRONG_PASSWORD (mocks/client-auth.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('a client signs in with email and password and lands on home', async ({ page }, testInfo) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(portal('/lvp/sign-in'));
    await expect(page.getByRole('heading', { name: 'Client portal: lvp' })).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`sign-in-${width}.png`), fullPage: true });
  }
  await expect(page).toHaveTitle('Sign in');
  await expect(page.locator('main main')).toHaveCount(0);

  const form = page.getByTestId('sign-in-form');
  await form.getByLabel('Email Address').fill('john@example.com');
  await form.getByLabel('Password', { exact: true }).fill('Wrong-password-1');
  await form.getByRole('button', { name: 'Sign In' }).click();
  await expect(form.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(form.getByLabel('Password', { exact: true })).toHaveValue('');

  await form.getByLabel('Password', { exact: true }).fill('Sample-pass-2026');
  await form.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(portal('/lvp/intake'));
  await expect(page.getByTestId('firm-name').first()).toBeVisible();
});

test('sign-in links to forgot password and sign-up', async ({ page }) => {
  await page.goto(portal('/lvp/sign-in'));
  await expect(page.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
    'href',
    '/lvp/forgot-password',
  );
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    '/lvp/sign-up',
  );
});
