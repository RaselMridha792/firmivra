import { expect, test } from '@playwright/test';
const port = process.env['WEB_PORT'] ?? '3000';
for (const site of ['app', 'admin']) {
  test(`${site}: account existence does not change recovery success`, async ({ page }) => {
    test.setTimeout(120_000);
    const known = site === 'admin' ? 'superadmin@firmivra.test' : 'owner@lvp.test';
    for (const email of ['unknown@firmivra.test', known]) {
      await page.goto(`http://${site}.localhost:${port}/forgot-password`);
      await page.getByLabel('Email Address').fill(email);
      await page.getByRole('button', { name: 'Send reset code' }).click();
      await expect(page.getByRole('status')).toContainText('If an account matches this email');
      await page.getByRole('link', { name: 'Enter your reset code' }).click();
      await page.getByLabel('Email Address').fill(email);
      await page.getByLabel('6-digit code').fill('999999');
      await page.getByLabel('New password', { exact: true }).fill('Firmivra-local-1');
      await page.getByLabel('Confirm new password').fill('mismatch');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await expect(page.getByText('The passwords do not match.')).toBeVisible();
      await page.getByLabel('Confirm new password').fill('Firmivra-local-1');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await expect(page.getByTestId('auth-screen').getByRole('alert')).toHaveText(
        'That code is not right or has expired.',
      );
      if (email !== known) continue;
      await page.getByLabel('6-digit code').fill('000000');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText(
        'Your password was reset. Sign in with your new password.',
      );
      await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
    }
  });
}
