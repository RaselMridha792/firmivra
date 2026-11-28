import { expect, test } from '@playwright/test';

// #35 Q23 (IP-041) part 2, in mock mode (mocks/invoices.ts): the portal says Pay Now takes a U.S.
// bank account (instant verification, card otherwise) only where the firm takes bank payments; the
// firm sees how a payment was made and "Payment pending" while a bank debit settles. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the portal explains bank payments only while the firm takes them', async ({ browser }) => {
  const on = await browser.newPage();
  await on.addInitScript(() => sessionStorage.setItem('firmivra-mock:ach', 'active'));
  await on.goto(portal('/lvp/invoices'));
  await expect(on.getByTestId('bank-payments-note')).toContainText(
    'if your bank is not listed, pay by card',
    { timeout: 60_000 },
  );
  await on.close();

  const off = await browser.newPage();
  await off.goto(portal('/lvp/invoices'));
  await expect(off.getByRole('table', { name: 'Current invoices' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(off.getByTestId('bank-payments-note')).toHaveCount(0);
  await off.close();
});

test('the firm sees a settling bank debit as Payment pending, and how each payment was made', async ({
  page,
}) => {
  // INV-2026-0100 (mock row 4): a bank debit still settling.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000004'));
  const payments = page.getByTestId('invoice-payments');
  await expect(payments).toContainText('Online (Stripe, bank (ACH) ••6789) · Payment pending', {
    timeout: 60_000,
  });
  // INV-2026-0081 (mock row 6): a card payment.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000006'));
  await expect(page.getByTestId('invoice-payments')).toContainText(
    'Online (Stripe, card ••4242) · Paid',
    {
      timeout: 60_000,
    },
  );
});
