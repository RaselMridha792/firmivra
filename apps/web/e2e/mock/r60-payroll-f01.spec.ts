// Octavia's Payroll Review 2, F01: the Connected Payroll Providers panel says how many
// clients chose each provider and which providers are authorized. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('F01: the providers panel counts the clients that chose each provider and says which are authorized', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  const card = page.getByTestId('card-providers');
  await expect(card.getByTestId('provider-states')).toContainText(
    'Authorized means the provider allowed access; figures arrive only after the first successful sync',
  );
  const rows = card.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    await expect(row).toContainText(/\d+ clients? chose it/);
  }
  // Never "Gusto 1 Client" beside Connect: chosen is not authorized.
  await expect(card).not.toContainText(/\d+ Clients?\b/);
  const none = rows.filter({ hasText: 'Not connected' });
  await expect(none).toContainText('1 client chose it');
  await expect(none.getByRole('button', { name: 'Not authorized · Connect' })).toBeVisible();
  // Gusto has sent data for Green Leaf Café: authorized.
  await expect(rows.filter({ hasText: 'Gusto' })).toContainText('Authorized');
});
