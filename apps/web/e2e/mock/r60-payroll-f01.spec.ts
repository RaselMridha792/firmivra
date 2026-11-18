// Octavia's Payroll Review 2, F01: the Connected Payroll Providers panel says how many
// clients chose each provider and its state in the same words as each client's Overview
// (pending setup, waiting for first sync, last sync). Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('F01: the providers panel counts the clients that chose each provider and gives its state', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  const card = page.getByTestId('card-providers');
  await expect(card.getByTestId('provider-states')).toContainText(
    'Pending setup: chosen for a client, not yet authorized in Integrations.',
  );
  const rows = card.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) {
    await expect(row).toContainText(/\d+ clients? chose it/);
  }
  // Never "Gusto 1 Client" beside Connect: chosen is not authorized.
  await expect(card).not.toContainText(/\d+ Clients?\b/);
  // OnPay is chosen by Jordan Services, not authorized: pending setup, with Connect.
  const pending = rows.filter({ hasText: 'OnPay' });
  await expect(pending).toContainText('1 client chose it');
  await expect(pending.getByRole('button', { name: 'Pending setup · Connect' })).toBeVisible();
  // Gusto has sent data for Green Leaf Café.
  await expect(rows.filter({ hasText: 'Gusto' })).toContainText('Connected · last sync');
});
