import { expect, type Page, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L12: search on the Leads page, in the filter row as on
// Clients. Every word must match, so a full name finds the lead; it combines with the filters and
// Reset clears it. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;
const shots = 'e2e/mock/r55-screenshots/leads';

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
const names = async (page: Page) =>
  (await table(page).getByRole('row').allInnerTexts()).slice(1).map((t) => t.replace(/\s+/g, ' '));

test('searches by full name, with the filters, and Reset clears it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(table(page).getByRole('row', { name: /Bruno Sandoval/ })).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Search leads' });
  await search.fill('Bruno Sandoval');
  await expect(table(page).getByRole('row')).toHaveCount(2);
  expect((await names(page))[0]).toContain('Bruno Sandoval');
  await page.screenshot({ path: `${shots}/search-full-name.png` });

  // A source the lead does not have (Bruno came from Instagram): nothing matches both.
  await page.getByLabel('All Lead Sources').selectOption({ label: 'Referral' });
  await expect(search).toHaveValue('Bruno Sandoval');
  await expect(table(page).getByRole('row', { name: /Bruno Sandoval/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(search).toHaveValue('');
  await expect(table(page).getByRole('row', { name: /Selma Shields/ })).toHaveCount(1);
});

test('fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(url);
  await page.getByRole('searchbox', { name: 'Search leads' }).fill('Selma');
  await expect(table(page).getByRole('row', { name: /Selma Shields/ })).toHaveCount(1);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${shots}/search-375.png` });
});
