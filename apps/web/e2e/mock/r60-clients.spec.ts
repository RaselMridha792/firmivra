import { expect, type Page, test } from '@playwright/test';

// Octavia's Clients review of Oct 25 (section E1), in mock mode as the Owner. The mock
// (src/mocks/clients.ts) has two clients owing documents and two with a balance. Fake data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients');
}
const card = (page: Page, label: string) => page.getByTestId('kpi-card').filter({ hasText: label });
const names = (page: Page) => page.getByTestId('clients-table').getByTestId('client-link');

test('E1: Pending Documents and Balances Due filter the list to the clients they count', async ({
  page,
}) => {
  await open(page);
  const docs = card(page, 'Pending Documents');
  const owed = card(page, 'Balances Due');
  await expect(docs).toHaveAttribute('aria-pressed', 'false', { timeout: 60_000 });
  // The summary has loaded: each card shows its number, not the "—" of loading.
  await expect(docs).toContainText(/\d/);
  await expect(owed).toContainText(/\d/);
  const docsCount = Number((await docs.innerText()).match(/\d+/)?.[0]);
  const owedCount = Number((await owed.innerText()).match(/\d+/)?.[0]);

  await docs.click();
  await expect(docs).toHaveAttribute('aria-pressed', 'true');
  await expect(names(page)).toHaveCount(docsCount);

  // The other card takes over; a second click clears it.
  await owed.click();
  await expect(owed).toHaveAttribute('aria-pressed', 'true');
  await expect(docs).toHaveAttribute('aria-pressed', 'false');
  await expect(names(page)).toHaveCount(owedCount);
  await owed.click();
  await expect(owed).toHaveAttribute('aria-pressed', 'false');
  await expect(names(page)).not.toHaveCount(owedCount);

  // Reset All clears a card's filter too.
  await docs.click();
  await page.getByRole('button', { name: /Reset/ }).click();
  await expect(docs).toHaveAttribute('aria-pressed', 'false');
});

test('E7: Return to Clients and Back bring the same list back; a new visit starts fresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(app('/clients'));
  const owed = card(page, 'Balances Due');
  await expect(owed).toHaveAttribute('aria-pressed', 'false', { timeout: 60_000 });
  await owed.click();
  await expect(page).toHaveURL(/\/clients\?owes=BALANCE$/);
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.waitForTimeout(300);

  // Return to Clients from the client's page: the filter and the scroll come back.
  await names(page).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.locator('main').getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page).toHaveURL(/\/clients\?owes=BALANCE$/);
  await expect(card(page, 'Balances Due')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // The browser's Back does the same.
  await names(page).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/clients\?owes=BALANCE$/);
  await expect(card(page, 'Balances Due')).toHaveAttribute('aria-pressed', 'true');

  // A new visit to Clients (the side menu's link) starts with no filter.
  await page.goto(app('/clients'));
  await expect(card(page, 'Balances Due')).toHaveAttribute('aria-pressed', 'false');
});
