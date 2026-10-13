import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 390, 768, 1440]) {
  test(`audit Details stay readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/audit-log`);
    const entries =
      width < 1280
        ? page.getByTestId('audit-mobile-entry')
        : page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
    await expect(entries).toHaveCount(6);
    const first = entries.first();
    await first.getByText('Details', { exact: true }).click();
    const details = first.getByTestId('audit-details');
    await expect(details.locator('dd').last()).toHaveText('mock-request-1');
    if (width < 1280) {
      for (const value of await details.locator('dt, dd').all()) {
        const box = await value.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(await value.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await expect(
        page.getByRole('button', { name: 'Previous', exact: true }).filter({ visible: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Next', exact: true }).filter({ visible: true }),
      ).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`audit-details-${width}.png`), fullPage: true });
    await first.getByText('Details', { exact: true }).click();
    await expect(details.locator('dl')).not.toBeVisible();
  });
}
