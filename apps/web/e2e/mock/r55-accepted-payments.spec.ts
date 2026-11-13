import { expect, test } from '@playwright/test';

// R55: Settings > Payments, Accepted Client Payments (PAY-3, IP-F14) in mock mode as the Owner.
// The mock firm has not connected Stripe, so every control is locked and says what it needs, and
// there is nothing to save. Turning cards off and on (with its confirmation) is checked on the API
// (accepted-payments.e2e). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('each locked payment method says which connection it needs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  const card = page.getByTestId('accepted-payments');

  const cards = card.getByTestId('method-card');
  await expect(cards.getByRole('switch', { name: 'Credit / debit cards' })).toBeDisabled();
  await expect(cards.getByRole('switch', { name: 'Credit / debit cards' })).not.toBeChecked();
  await expect(cards).toContainText('Connect Stripe first');
  await expect(card.getByTestId('method-ach')).toContainText('Not offered yet');
  await expect(card.getByTestId('method-paypal')).toContainText('Connect PayPal first');
  await expect(card.getByRole('combobox', { name: 'Default card processor' })).toBeDisabled();
  await expect(card.getByRole('combobox', { name: 'Default card processor' })).toContainText(
    'Stripe (not ready)',
  );
  await expect(card.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await expect(card.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await card.screenshot({ path: 'test-results/r55-accepted-payments-1440.png' });
});
