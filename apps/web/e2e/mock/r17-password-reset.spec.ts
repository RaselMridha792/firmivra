import { expect, test } from '@playwright/test';

// N03 forgot and reset password in mock mode: the reset code is MOCK_CODE (000000).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('forgot password sends a code and the reset page changes the password', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/forgot-password'));
  await expect(page).toHaveTitle('Forgot password');
  await page.getByLabel('Email Address').fill('nobody@example.test');
  await page.getByRole('button', { name: 'Send Reset Code' }).click();

  // The same next page whether or not the email has an account; the email is not in the URL.
  await expect(page).toHaveURL(portal('/lvp/reset-password'));
  await expect(page).toHaveTitle('Reset password');
  await expect(page.getByLabel('Email Address')).toHaveValue('nobody@example.test');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`reset-${width}.png`), fullPage: true });
  }
  await page.getByLabel('Reset code').fill('000000');
  await page.getByLabel('New Password', { exact: true }).fill('Sample-pass-2026');
  await page.getByLabel('Confirm New Password').fill('Sample-pass-2027');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(page.getByText('The passwords do not match')).toBeVisible();

  await page.getByLabel('Confirm New Password').fill('Sample-pass-2026');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(page.getByTestId('password-changed')).toBeVisible();
  await expect(page).toHaveURL(portal('/lvp/reset-password'));
});

test('the reset page opened from its URL asks for the email', async ({ page }) => {
  await page.goto(portal('/lvp/reset-password'));
  await expect(page.getByLabel('Email Address')).toHaveValue('');
  await page.getByRole('button', { name: 'Change Password' }).click();
  await expect(page.getByText('Enter the 6-digit code', { exact: true })).toBeVisible();
});
