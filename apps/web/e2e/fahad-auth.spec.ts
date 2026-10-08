import { expect, test } from '@playwright/test';
const port = process.env['WEB_PORT'] ?? '3000';
for (const site of ['app', 'admin']) {
  test(`${site}: first MFA setup shows QR and secret`, async ({ page }) => {
    const auth = site === 'admin' ? '/api/v1/admin/auth' : '/api/v1/auth';
    await page.route(`**${auth}/sign-in`, (route) =>
      route.fulfill({
        json: { status: 'MFA_SETUP_REQUIRED', session: 'synthetic-challenge' },
      }),
    );
    await page.route(`**${auth}/mfa/setup`, (route) =>
      route.fulfill({
        json: {
          session: 'synthetic-setup',
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Firmivra:test?secret=JBSWY3DPEHPK3PXP&issuer=Firmivra',
        },
      }),
    );
    await page.goto(`http://${site}.localhost:${port}/sign-in`);
    await page.getByLabel('Email Address').fill('synthetic@firmivra.test');
    await page.getByLabel('Password', { exact: true }).fill('Synthetic-local-1');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Authenticator setup QR code' })).toBeVisible();
    await expect(page.getByText('JBSWY3DPEHPK3PXP', { exact: true })).toBeVisible();
    const submitted = page.waitForRequest((request) => request.url().endsWith(`${auth}/mfa`));
    await page.route(`**${auth}/mfa`, (route) =>
      route.fulfill({
        status: 401,
        json: { code: 'INVALID_MFA_CODE', message: 'Invalid verification code' },
      }),
    );
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify code' }).click();
    expect((await submitted).postDataJSON()).toEqual({
      session: 'synthetic-setup',
      code: '123456',
    });
  });
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
