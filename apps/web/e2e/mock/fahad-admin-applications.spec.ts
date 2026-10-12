import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 1440, 1672]) {
  test(`applications design and existing filters at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://admin.localhost:${port}/applications`);
    await expect(page.getByTestId('page-title')).toHaveText('Firm Applications');
    await expect(page.getByRole('tab', { name: 'All Applications (8)' })).toBeVisible();
    const filters = page.getByTestId('application-filters');
    const tabs = await page.getByRole('tablist').boundingBox();
    const box = await filters.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height);
    await expect(filters).toContainText('Status');
    await expect(filters).toContainText('Date Range');
    if (width >= 1280) {
      const frame = page.locator('table').locator('..');
      expect(await frame.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      await expect(page.getByRole('columnheader')).toHaveText([
        /Row/,
        'Business Name',
        'Business Type',
        'Owner / Contact',
        'Email',
        'Services',
        'Requested Plan',
        'Submitted',
        'Status',
        'Action',
      ]);
    }
    await page.getByRole('searchbox', { name: 'Search applications' }).fill('Harbor');
    await expect(
      page.getByRole('link', { name: /Open application for/ }).filter({ visible: true }),
    ).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search applications' }).clear();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`applications-${width}.png`), fullPage: true });
  });
}
