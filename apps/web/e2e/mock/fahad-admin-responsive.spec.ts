import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [320, 375, 390, 640, 768, 820, 1024, 1280, 1440, 1920]) {
  test(`admin dashboard and application filters fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://admin.localhost:${port}/`);
    const dashboard = page.getByTestId('dashboard');
    await expect(dashboard).toBeVisible();
    await expect(page.getByTestId('platform-growth').getByRole('img')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const card of await dashboard.locator('section').all()) {
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: true });

    await page.goto(`http://admin.localhost:${port}/applications`);
    const filters = page.getByTestId('application-filters');
    await expect(filters).toBeVisible();
    for (const select of await filters.locator('select').all()) {
      const box = await select.boundingBox();
      const parent = await filters.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(parent!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(parent!.x + parent!.width);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const tabs = page.getByRole('tablist', { name: 'Application status' });
    expect(await tabs.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByLabel('Filter by status').selectOption('PENDING_REVIEW');
    await expect(page.getByLabel('Filter by status')).toHaveValue('PENDING_REVIEW');
    await page.getByLabel('Filter by date range').selectOption('30');
    await expect(page.getByLabel('Filter by date range')).toHaveValue('30');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`applications-${width}.png`), fullPage: true });
  });
}
