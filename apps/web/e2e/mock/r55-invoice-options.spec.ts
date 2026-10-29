import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F04: Create Invoice's Additional
// Settings. The email to the client starts unchecked; the tip and payment-before-due options
// show only once Settings > Payments turns them on. Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('nothing on to start; the tip and before-due options follow Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  const options = page.getByRole('region', { name: 'Additional Settings' });
  await expect(options.getByLabel('Send email notification to client')).not.toBeChecked();
  await expect(options).toContainText("No email: the invoice opens in the client's portal only.");
  await expect(options.getByLabel('Allow client to add a tip')).toHaveCount(0);
  await expect(options.getByLabel('Require payment before due date')).toHaveCount(0);
  await expect(options.getByRole('link', { name: 'Settings > Payments' })).toBeVisible();

  // Settings > Payments turns both on.
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  await page.getByRole('switch', { name: 'Tipping' }).click();
  await page.getByRole('switch', { name: 'Payment before the due date' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();

  await page.getByRole('link', { name: 'Invoices & Payments' }).first().click();
  await page.getByRole('link', { name: 'Create Invoice' }).first().click();
  await expect(options.getByLabel('Allow client to add a tip')).not.toBeChecked();
  await expect(options.getByLabel('Require payment before due date')).not.toBeChecked();
  await page.getByLabel('Client *').selectOption({ label: 'Jamie Sample' });
  await page.getByLabel('Payment Terms').selectOption('net_30');
  await page.getByLabel('Description 1 *').fill('Tax return preparation (fake)');
  await page.getByLabel('Rate 1 *').fill('100');
  await options.getByLabel('Allow client to add a tip').check();
  await expect(options).toContainText('Pay Now charges the balance due; tips are not added yet.');
  await options.getByLabel('Require payment before due date').check();
  await options.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/invoice-options.png' });

  await page.getByRole('button', { name: 'Preview Invoice' }).first().click();
  await expect(page.getByTestId('invoice-preview')).toContainText(
    'Please pay before the due date.',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]+$/);
  const detail = page.getByTestId('invoice-detail');
  await expect(detail).toContainText('Email to ClientOff: portal only');
  await expect(detail).toContainText('TipsAllowed (not added to Pay Now yet)');
  await expect(detail).toContainText('PaymentRequired before the due date');
});
