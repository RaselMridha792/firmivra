import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (route: string) => `http://app.localhost:${port}${route}`;
const authRoutes = ['/activate', '/forgot-password', '/reset-password', '/sign-in'];
for (const width of [375, 768, 1024, 1440, 1536]) {
  test(`firm public screens fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    for (const route of [...authRoutes, '/apply', '/apply/done', '/welcome']) {
      await page.goto(app(route));
      await page.evaluate(() => document.fonts.ready);
      if (authRoutes.includes(route)) {
        await expect(page.locator('.auth-card')).toBeVisible();
        if (width >= 1440)
          await expect(page.locator('.auth-logo-light')).toHaveCSS('height', '152px');
      } else await expect(page.locator('h1').first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        route,
      ).toBe(true);
      if (width === 375 || width === 1536)
        await page.screenshot({
          path: info.outputPath(`${route.slice(1).replaceAll('/', '-')}-${width}.png`),
          fullPage: true,
        });
    }
  });
}
for (const width of [375, 1440]) {
  test(`all setup steps fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto(app('/setup'));
    await expect(page.getByTestId('brand-preview')).toBeVisible();
    await page.getByLabel('Portal name').fill('Sample Client Portal');
    for (const name of ['Branding', 'Business details', 'Team and access', 'Client portal']) {
      await expect(page.locator('[aria-current="step"]')).toContainText(name);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        name,
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`setup-${name.replaceAll(' ', '-')}-${width}.png`),
        fullPage: true,
      });
      if (name === 'Client portal')
        await page.getByLabel('Welcome message').fill('Welcome to your client portal.');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await expect(page.getByTestId('finish-item')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
