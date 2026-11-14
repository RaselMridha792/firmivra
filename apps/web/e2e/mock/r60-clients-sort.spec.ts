import { expect, test, type Page } from '@playwright/test';

// R60, Clients Review 2 (G12): Sort by orders the list, newest first by default, oldest first or
// by name either way, in the table and the cards alike (both show the API's order). Mock mode as
// the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-clients-sort';

test.describe.configure({ timeout: 180_000 });

/** The names on the page, or [] while a page is loading. */
async function namesIn(page: Page, scope: 'clients-table' | 'client-card') {
  const links =
    scope === 'clients-table'
      ? page.getByTestId('clients-table').getByTestId('client-link')
      : page.getByTestId('client-card').getByTestId('client-link');
  return links.allInnerTexts();
}

/** 1: the names run A to Z; -1: Z to A; 0: neither (or nothing shown yet). */
function direction(names: string[]) {
  if (names.length < 2) return 0;
  const up = names.every((n, i) => i === 0 || names[i - 1]!.localeCompare(n) <= 0);
  const down = names.every((n, i) => i === 0 || names[i - 1]!.localeCompare(n) >= 0);
  return up ? 1 : down ? -1 : 0;
}

test('Sort by orders the table by name and back to newest first', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('clients-table').getByTestId('client-link').first()).toBeVisible({
    timeout: 60_000,
  });
  const newest = await namesIn(page, 'clients-table');
  const sort = page.getByLabel('Sort by');
  await expect(sort).toHaveValue('NEWEST');

  await sort.selectOption('NAME_ASC');
  await expect.poll(async () => direction(await namesIn(page, 'clients-table'))).toBe(1);
  await sort.selectOption('NAME_DESC');
  await expect.poll(async () => direction(await namesIn(page, 'clients-table'))).toBe(-1);
  await sort.selectOption('NEWEST');
  await expect.poll(() => namesIn(page, 'clients-table')).toEqual(newest);
});

test('the cards follow the same order at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('client-card').first()).toBeVisible({ timeout: 60_000 });
  const newest = await namesIn(page, 'client-card');
  await page.getByLabel('Sort by').selectOption('NAME_ASC');
  await expect.poll(async () => direction(await namesIn(page, 'client-card'))).toBe(1);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/cards-sorted.png` });
  await page.getByLabel('Sort by').selectOption('OLDEST');
  await expect.poll(() => namesIn(page, 'client-card')).not.toEqual(newest);
});
