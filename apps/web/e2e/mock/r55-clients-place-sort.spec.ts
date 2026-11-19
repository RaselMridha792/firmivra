import { expect, type Page, test } from '@playwright/test';

// R55, Clients §6 (R61's sweep): Back and Return to Clients bring the list back exactly, its
// order too. Sort by Name A to Z with a search, open a client, go Back: still A to Z, the search
// kept. A new visit starts at Newest first. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

const names = (page: Page) => page.getByTestId('clients-table').getByTestId('client-link');
const sortBy = (page: Page) => page.getByLabel('Sort by');
/** The list's own search (the header has a Search clients box too). */
const search = (page: Page) => page.locator('input[aria-describedby="client-search-hint"]');

/** True when the names on the page run A to Z (and there are at least two). */
async function aToZ(page: Page) {
  const list = await names(page).allInnerTexts();
  return list.length > 1 && list.every((n, i) => i === 0 || list[i - 1]!.localeCompare(n) <= 0);
}

/** The list as it should come back: the address, the Sort by choice, the order and the search. */
async function expectPlace(page: Page) {
  await expect(page).toHaveURL(/\/clients\?search=a&sort=NAME_ASC$/);
  await expect(sortBy(page)).toHaveValue('NAME_ASC');
  await expect(search(page)).toHaveValue('a');
  await expect.poll(() => aToZ(page)).toBe(true);
}

test('Clients §6: Back and Return to Clients keep Sort by Name A to Z, and the search', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(names(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(sortBy(page)).toHaveValue('NEWEST');

  await search(page).fill('a');
  await sortBy(page).selectOption('NAME_ASC');
  await expectPlace(page);

  // The browser's Back from the client's page.
  await names(page).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.goBack();
  await expectPlace(page);

  // Return to Clients from the client's page.
  await names(page).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.locator('main').getByRole('link', { name: 'Clients', exact: true }).click();
  await expectPlace(page);

  // Newest first again leaves the order out of the address.
  await sortBy(page).selectOption('NEWEST');
  await expect(page).toHaveURL(/\/clients\?search=a$/);

  // A new visit to Clients starts at Newest first.
  await sortBy(page).selectOption('NAME_DESC');
  await expect(page).toHaveURL(/sort=NAME_DESC/);
  await page.goto(app('/clients'));
  await expect(sortBy(page)).toHaveValue('NEWEST');
});
