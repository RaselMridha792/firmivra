import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const SHOTS =
  'C:/Users/RASEL/AppData/Local/Temp/claude/413528402ba143c3/4624afb5-713d-4b9b-b179-fb33e7bd6a1d/scratchpad/shots';

test('look (temporary)', async ({ page }) => {
  await page.setViewportSize({ width: 1165, height: 900 });
  await page.goto(`${app}/intake-forms`);
  const table = page.getByRole('table', { name: 'Client intake forms' });
  await expect(table).toBeVisible();
  await page
    .getByRole('combobox', { name: /per page/i })
    .selectOption('24')
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/list-24.png`, fullPage: true });
  await page.getByPlaceholder('Search forms...').fill('Bruno');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/list-search.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app}/intake-forms`);
  await expect(table).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/list-1440.png`, fullPage: true });
});
