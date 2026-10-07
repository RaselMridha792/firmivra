import { expect, test } from '@playwright/test';
const port = process.env['WEB_PORT'] ?? '3000';
for (const site of ['app', 'admin']) {
  test(`${site}: real password and MFA, then local quick sign-in`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`http://${site}.localhost:${port}/sign-in`);
    await page
      .getByLabel('Email Address')
      .fill(site === 'admin' ? 'superadmin@firmivra.test' : 'owner@lvp.test');
    await page.getByLabel('Password', { exact: true }).fill('Firmivra-local-1');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByTestId('mfa-form')).toBeVisible();
    await page.getByLabel('6-digit code').fill('999999');
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByTestId('auth-screen').getByRole('alert')).toContainText('code');
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page).toHaveURL(`http://${site}.localhost:${port}/`);
  });
  test(`${site}: desktop/mobile login stays within viewport`, async ({ page }) => {
    for (const width of [1536, 375]) {
      await page.setViewportSize({ width, height: 1024 });
      await page.goto(`http://${site}.localhost:${port}/sign-in`);
      await expect(page.getByTestId('sign-in-form')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.getByLabel('Email Address').focus();
      expect(
        await page
          .getByLabel('Email Address')
          .evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth)),
      ).toBeGreaterThanOrEqual(2);
    }
  });
}
