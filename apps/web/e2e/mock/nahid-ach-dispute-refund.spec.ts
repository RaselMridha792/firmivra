import { expect, test } from '@playwright/test';

// #35 Q23 (IP-041) part 3, in mock mode (mocks/invoices.ts): a payment the client disputed with
// their bank shows "Disputed" while the invoice stays paid, and a bank payment is refunded in full
// only (a card can still be refunded in part). Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a disputed bank payment shows Disputed and refunds in full only', async ({ page }) => {
  // INV-2025-0072 (mock row 8): paid by bank (ACH), then disputed.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000008'));
  const payments = page.getByTestId('invoice-payments');
  await expect(payments).toContainText('Online (Stripe, bank (ACH) ••6789) · Paid', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('payment-disputed')).toHaveText('· Disputed');

  await payments.getByRole('button', { name: 'Issue Refund' }).click();
  const dialog = page.getByRole('dialog');
  const amount = dialog.getByLabel('Amount to refund');
  await expect(amount).toHaveValue('275.00');
  await expect(amount).toHaveAttribute('readonly', '');
  await expect(dialog).toContainText('A bank payment can only be refunded in full.');
  await dialog.getByRole('button', { name: 'Issue Refund' }).click();
  await expect(dialog).toBeHidden();
  await expect(payments).toContainText('Refund pending');
  // Nothing is left to refund: no second refund.
  await expect(payments.getByRole('button', { name: 'Issue Refund' })).toHaveCount(0);
});

test('a card payment can still be refunded in part', async ({ page }) => {
  // INV-2026-0012 (mock row 7): a card payment, $25.00 of it refunded already.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000007'));
  const payments = page.getByTestId('invoice-payments');
  await expect(payments).toContainText('Online (Stripe, card ••4242)', { timeout: 60_000 });
  await expect(page.getByTestId('payment-disputed')).toHaveCount(0);
  await payments.getByRole('button', { name: 'Issue Refund' }).click();
  const amount = page.getByRole('dialog').getByLabel('Amount to refund (at most $125.00)');
  await expect(amount).not.toHaveAttribute('readonly');
  await expect(page.getByRole('dialog')).not.toContainText('refunded in full');
});
