import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F04: Create Invoice's Additional
// Settings. The email to the client starts unchecked; the tip shows only once Settings > Payments
// turns it on. Payment before the due date is withdrawn (Review Two, I-D01): offered nowhere.
// Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('nothing on to start; the tip follows Settings, and nothing asks for payment before the due date', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  const options = page.getByRole('region', { name: 'Additional Settings' });
  await expect(options.getByLabel('Send email notification to client')).not.toBeChecked();
  await expect(options).toContainText("No email: the invoice opens in the client's portal only.");
  await expect(options.getByLabel('Allow client to add a tip')).toHaveCount(0);
  await expect(options).toContainText('Tipping shows here once turned on in Settings > Payments.');
  await expect(options.getByRole('link', { name: 'Settings > Payments' })).toBeVisible();

  // Settings > Payments turns tipping on; it has no before-due switch any more (I-D01).
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  await page.getByRole('switch', { name: 'Tipping' }).click();
  await expect(page.getByRole('switch', { name: 'Payment before the due date' })).toHaveCount(0);
  await page.getByTestId('billing-actions').getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();

  await page.getByRole('link', { name: 'Invoices & Payments' }).first().click();
  await page.getByRole('link', { name: 'Create Invoice' }).first().click();
  await expect(options.getByLabel('Allow client to add a tip')).not.toBeChecked();
  await expect(options.getByLabel('Require payment before due date')).toHaveCount(0);
  await expect(options).not.toContainText('before the due date');
  await page.getByLabel('Client *').selectOption({ label: 'Jamie Sample' });
  await page.getByLabel('Payment Terms').selectOption('net_30');
  await page.getByLabel('Description 1 *').fill('Tax return preparation (fake)');
  await page.getByLabel('Rate 1 *').fill('100');
  await options.getByLabel('Allow client to add a tip').check();
  // I-N05 (Q22): the tip is offered at the portal's Pay Now.
  await expect(options.getByTestId('tip-note')).toHaveText(
    'The client can add a tip at Pay Now. It is charged with the payment and does not count toward the invoice.',
  );
  await options.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/invoice-options.png' });

  await page.getByRole('button', { name: 'Preview Invoice' }).first().click();
  await expect(page.getByTestId('invoice-preview')).toContainText('Tax return preparation (fake)');
  await expect(page.getByTestId('invoice-preview')).not.toContainText('Please pay before');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]+$/);
  const detail = page.getByTestId('invoice-detail');
  await expect(detail).toContainText('Email to ClientOff: portal only');
  await expect(detail).toContainText('TipsAllowed (not added to Pay Now yet)');
  await expect(detail).not.toContainText('Required before the due date');
});
