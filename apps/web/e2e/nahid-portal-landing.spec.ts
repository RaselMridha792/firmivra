import { expect, test } from '@playwright/test';

test('N01 landing, legal and unknown firm', async ({ page }, testInfo) => {
  const offset = testInfo.project.testDir.endsWith('mock') ? 1 : 0;
  const port = Number(process.env['WEB_PORT'] ?? '3000') + offset;
  const portal = (path: string) => `http://portal.localhost:${port}${path}`;
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(portal('/lvp'));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your Documents');
    await expect(page.getByRole('heading', { name: /^What You Can Do/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toBeVisible();
    await expect(page.getByText(/clients of LVP Accounting & Taxes\.$/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
    for (const name of ['Terms of Service', 'Privacy Policy']) {
      await page.getByRole('button', { name }).click();
      await expect(page.getByRole('dialog')).toContainText('Version');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
  }
  await expect(page).toHaveTitle(/Client portal/);
  await page.getByRole('link', { name: 'Create an Account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up'));
  await page.goto(portal('/unknown-firm'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
