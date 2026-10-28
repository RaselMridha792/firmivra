import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F05: Create Invoice's Recurring card.
// Off keeps a one-time invoice; on, a named frequency or every N weeks, months or years (1 to 52)
// with an end rule. The schedule waits until the invoice is sent, then starts from that day.
// Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const us = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

test('a custom schedule waits as a draft and starts when the invoice is sent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Payment Terms').selectOption('net_30');
  await page.getByLabel('Description 1 *').fill('Monthly bookkeeping (fake)');
  await page.getByLabel('Rate 1 *').fill('350');

  const card = page.getByTestId('invoice-recurring');
  await expect(card).toContainText('Off: this is a one-time invoice.');
  await card.getByRole('switch', { name: 'Repeat this invoice' }).click();
  const frequency = card.getByLabel('Frequency');
  await expect(frequency.locator('option')).toHaveText([
    'Weekly',
    'Biweekly (every two weeks)',
    'Semi-monthly (twice a month)',
    'Monthly',
    'Quarterly',
    'Semiannual (every six months)',
    'Annual',
    'Custom',
  ]);
  await frequency.selectOption('CUSTOM');
  await card.getByLabel('Repeat every').fill('53');
  await card.getByLabel('Unit').selectOption('WEEK');
  await expect(card.getByTestId('recurring-summary')).toContainText('every 1 to 52');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(card.getByText('Repeat at most every 52')).toBeVisible();

  await card.getByLabel('Repeat every').fill('3');
  await expect(card.getByTestId('recurring-summary')).toContainText('Every 3 weeks');
  await expect(card.getByTestId('recurring-summary')).toContainText(
    `Next: ${us(inDays(21))}, ${us(inDays(42))}, ${us(inDays(63))}`,
  );
  // An end before the second invoice is refused before saving.
  await card.getByLabel('On a date').check();
  await card.getByLabel('End date').fill(iso(inDays(10)));
  await expect(card.getByTestId('recurring-summary')).toContainText('ends before the next invoice');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(card.getByText(`End on or after the next invoice, ${us(inDays(21))}`)).toBeVisible();

  await card.getByLabel('After a number of invoices').check();
  await card.getByLabel('Number of invoices, this one included').fill('6');
  await expect(card).toContainText('auto-send and AutoPay stay off');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/invoice-recurring.png' });

  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Every 3 weeks · starts when this invoice is sent')).toBeVisible();

  // The draft opens with its schedule, and sending starts it from today.
  await page.getByRole('link', { name: /edit/i }).first().click();
  await expect(page.getByTestId('invoice-recurring').getByRole('switch')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('invoice-recurring').getByLabel('Repeat every')).toHaveValue('3');
  await page.getByRole('button', { name: 'Send Invoice' }).click();
  await expect(page.getByText(`Every 3 weeks · next ${us(inDays(21))}`)).toBeVisible();
});

test('turning Recurring off keeps a one-time invoice', async ({ page }) => {
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  await page.getByLabel('Client *').selectOption({ index: 1 });
  await page.getByLabel('Payment Terms').selectOption('net_30');
  await page.getByLabel('Description 1 *').fill('Annual return (fake)');
  await page.getByLabel('Rate 1 *').fill('450');
  const toggle = page.getByTestId('invoice-recurring').getByRole('switch');
  await toggle.click();
  await page.getByTestId('invoice-recurring').getByLabel('Frequency').selectOption('QUARTERLY');
  await toggle.click();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByText('Payment Terms')).toBeVisible();
  await expect(page.getByText('Recurring', { exact: true })).toHaveCount(0);
});
