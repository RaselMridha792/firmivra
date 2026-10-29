import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F12: Settings > Payments' deposit
// accounts, Record Payment's Deposit To and Send Receipt (off unless Automatic Receipts is on),
// and Resend Receipt on the invoice. Mock mode, as the Owner; INV-2026-0098 ($225.00) is overdue.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('a payment deposited to the firm’s account, with a receipt only when ticked', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  const accounts = page.getByRole('region', { name: 'Deposit accounts', exact: true });
  await expect(accounts).toContainText('No deposit accounts yet.');
  await page.getByLabel('Account name').fill('Operating Account (fake)');
  await page.getByRole('button', { name: 'Add Account' }).click();
  await expect(accounts).toContainText('Operating Account (fake)');
  await page.getByLabel('Account name').fill('Savings (fake)');
  await page.getByRole('button', { name: 'Add Account' }).click();
  await accounts.getByRole('button', { name: 'Make default Operating Account (fake)' }).click();
  await expect(accounts.getByRole('listitem').first()).toContainText('Default');

  await page.getByRole('link', { name: 'Invoices & Payments' }).first().click();
  await page
    .getByRole('tablist', { name: 'Invoice views' })
    .getByRole('tab', { name: /^Overdue/ })
    .click();
  await page.getByRole('button', { name: 'Actions for INV-2026-0098' }).click();
  await page.getByRole('menuitem', { name: 'Record Payment' }).click();
  await expect(page.getByLabel('Deposit To')).toHaveValue(/.+/);
  await expect(page.getByLabel('Deposit To').locator('option:checked')).toHaveText(
    'Operating Account (fake)',
  );
  // Automatic Receipts is off: no receipt unless ticked.
  const receipt = page.getByLabel('Send receipt to client');
  await expect(receipt).not.toBeChecked();
  await expect(
    page.getByText('No receipt: you can send one from the invoice later.'),
  ).toBeVisible();
  await page.getByLabel('Amount Received ($) *').fill('25');
  await page.getByLabel('Payment Method *').selectOption('CASH');
  await receipt.check();
  await expect(
    page.getByText('A receipt is emailed to the client once the payment is recorded.'),
  ).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/record-payment-receipt.png' });
  await page.getByRole('button', { name: 'Record Payment' }).click();

  const payments = page.getByTestId('invoice-payments');
  await expect(payments).toContainText('Deposited to Operating Account (fake)');
  await expect(payments).toContainText('Receipt sent');
  await payments.getByRole('button', { name: 'Resend Receipt' }).first().click();
  await expect(payments.getByRole('button', { name: 'Resend Receipt' }).first()).toBeEnabled();
});
