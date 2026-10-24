import { expect, test } from '@playwright/test';

// Settings > Payments on her design (Payments guide of Oct 18): the Stripe, Square and PayPal
// cards, Accepted Client Payments and Payout Settings. Mock mode (playwright.mock.config.ts) as
// the Owner; the mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const payments = `http://app.localhost:${port}/settings/payments`;

test('three providers; Square and PayPal say why they cannot connect; what clients can pay with', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(payments);
  await expect(page.getByTestId('payments-stage')).toHaveText('Not connected', { timeout: 60_000 });
  for (const [card, action] of [
    ['provider-square', 'Connect Square'],
    ['provider-paypal', 'Connect PayPal'],
  ] as const) {
    const provider = page.getByTestId(card);
    await expect(provider).toContainText('Not connected');
    await expect(provider.getByRole('button', { name: action })).toBeDisabled();
    await expect(provider).toContainText('Firmivra has not set up this connection yet');
  }
  const accepted = page.getByTestId('accepted-payments');
  await expect(accepted.getByRole('switch', { name: 'Credit / debit cards' })).not.toBeChecked();
  await expect(accepted.getByRole('switch', { name: 'ACH bank payments' })).toBeDisabled();
  await expect(accepted).toContainText('Connect PayPal to enable');
  // Payouts wait for Stripe; no Stripe links before it is connected.
  await expect(page.getByTestId('payout-settings')).toContainText('Connect Stripe first');
  await expect(page.getByTestId('stripe-manage')).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Invoices & Payments' }),
  ).toHaveAttribute('href', '/invoices');
});

test('once Stripe is connected, its Dashboard manages the connection, the bank and instant payouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(payments);
  await page.getByRole('button', { name: 'Connect Stripe' }).click({ timeout: 60_000 });
  await expect(page.getByTestId('payments-stage')).toHaveText('Setup not finished');
  const manage = page.getByTestId('stripe-manage');
  await expect(manage).toHaveAttribute('href', 'https://dashboard.stripe.com/settings/account');
  await expect(manage).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('stripe-bank')).toHaveAttribute(
    'href',
    'https://dashboard.stripe.com/settings/payouts',
  );
  await expect(page.getByTestId('stripe-instant')).toContainText('Check Eligibility');
});
