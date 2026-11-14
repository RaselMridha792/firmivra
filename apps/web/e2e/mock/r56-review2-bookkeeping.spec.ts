import { expect, test } from '@playwright/test';

// Octavia's Review 2, Bookkeeping: the screen-only corrections (N02, N05, N08, E01b, I01, the
// desktop tabs), checked in mock mode as an Owner on Green Leaf Café's workspace.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('View All keeps the client and service, Categorize opens Transactions, and the tab survives a reload', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  // N02 and the Tasks tab scope: the canonical pages open on this client (and its service).
  await expect(
    page.getByTestId('shared-documents').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/documents\?clientId=[0-9a-f-]{36}&serviceId=[0-9a-f-]{36}/);
  await expect(
    page.getByTestId('shared-tasks').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/tasks\?clientId=[0-9a-f-]{36}/);
  // N08: Categorize Transactions opens Transactions, and the address keeps it.
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Categorize Transactions' })
    .click();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=transactions/);
  await page.reload();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
});

test('the software card says linked and authorized apart from synced (I01)', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  const card = page.getByTestId('software');
  await expect(card.getByTestId('provider-states')).toContainText(
    'figures arrive only after the first successful sync',
  );
  await expect(card).toContainText(/client(s)? linked/);
  await expect(card).toContainText(/Authorized|Not authorized/);
});

test("Terms' Payment Schedule View All opens this client's invoices (E01b)", async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}/terms`);
  await expect(
    page.getByTestId('terms-schedule').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', /^\/invoices\?client=[0-9a-f-]{36}/);
});
