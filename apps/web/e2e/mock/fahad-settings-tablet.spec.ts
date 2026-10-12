import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 768, 820, 1024, 1440]) {
  test(`settings menu and content fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto(`http://app.localhost:${port}/settings/branding`);
    const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
    await expect(nav.getByRole('link', { name: 'Branding', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByLabel('Portal name', { exact: true })).toBeVisible();
    const navBox = await nav.boundingBox();
    const inputBox = await page.getByLabel('Portal name', { exact: true }).boundingBox();
    if (width < 1280) {
      expect(inputBox!.y).toBeGreaterThan(navBox!.y + navBox!.height);
      expect(inputBox!.width).toBeGreaterThan(200);
    } else expect(inputBox!.x).toBeGreaterThan(navBox!.x + navBox!.width);
    for (const link of await nav.getByRole('link').all()) {
      expect(await link.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`settings-branding-${width}.png`),
      fullPage: true,
    });
    await nav.getByRole('link', { name: 'Client portal', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Client portal', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
