import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
for (const width of [375, 768, 1024, 1440]) {
  test(`workspace list fits ${width}px and filters by service`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/workspaces`);
    const list = page.getByTestId(width < 768 ? 'workspace-cards' : 'workspace-table');
    await expect(list).toContainText('Bookkeeping (Growth)');
    await page.getByLabel('Service', { exact: true }).selectOption('TAX_PLANNING');
    await expect(list).toContainText('2026 Tax Planning');
    await expect(list).not.toContainText('Bookkeeping (Growth)');
    await page.getByLabel('Search workspaces').fill('No matching service');
    await expect(page.getByText('No workspaces match these filters.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
