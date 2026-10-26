import { expect, test } from '@playwright/test';

// SH7 (Octavia's Oct 25 review: PY-F01; BK-I01): a provider saved for a client is not
// "Connected" until data came from it; the connection and the sync are shown apart, with times
// only from real syncs. Mock mode, as an Owner. Roberts & Co. has no payroll provider yet.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('Payroll: a newly saved provider is Pending setup, never synced, in the card and Sync Details', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: 'Connect Payroll Provider' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect Payroll Provider' });
  await dialog.getByLabel('Payroll client').selectOption({ label: 'Roberts & Co.' });
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(
    page.getByText(
      'Provider saved for this client. It shows as connected after its first successful sync.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Provider connected.')).toHaveCount(0);

  await page.getByPlaceholder('Search clients, business name, or EIN...').fill('Roberts');
  await page.getByTestId('client-link').filter({ hasText: 'Roberts & Co.' }).click();
  const card = page.getByTestId('stat-provider');
  await expect(card).toContainText('Pending setup');
  await expect(card).not.toContainText(/\bConnected\b/);
  await expect(page.getByTestId('provider-sync')).toHaveText('Never synced');

  await page.getByRole('button', { name: 'Client Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View Sync Details' }).click();
  const details = page.getByTestId('sync-details');
  await expect(details).toContainText('Pending setup. No data has come from Gusto yet.');
  await expect(details).toContainText('Never synced');
  await expect(details).not.toContainText(/Connection\s*Connected/);
});

test('Payroll: a provider that sends data is Connected, with its last sync', async ({ page }) => {
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  await expect(page.getByTestId('stat-provider')).toContainText('Connected');
  await expect(page.getByTestId('provider-sync')).toHaveText(/^Synced /);
});

test('Bookkeeping: the software card shows the connection and the sync apart', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  await page
    .getByRole('link', { name: /Green Leaf/ })
    .first()
    .click();
  await expect(page.getByTestId('software-state')).toHaveText(/^Data is coming from /);
  await expect(page.getByTestId('software-sync')).toHaveText(/^Synced /);
});
