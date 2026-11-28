import { expect, test, type Page } from '@playwright/test';

// #34 Q22 (I-N05, R1-4), the portal's Pay Now with a tip, in mock mode (mocks/invoices.ts). An
// invoice that allows a tip (INV-2026-0102, 450.00 due) asks first while Tipping is on: No tip,
// 10%, 15%, 20% or a custom amount, with the total charged. Without Tipping, or on an invoice
// that does not allow one, Pay Now goes straight to checkout. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function invoices(page: Page, tipping: boolean) {
  if (tipping)
    await page.addInitScript(() => sessionStorage.setItem('firmivra-mock:tipping', 'on'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/invoices'));
  await expect(page.getByRole('table', { name: 'Current invoices' })).toContainText(
    'INV-2026-0102',
    { timeout: 60_000 },
  );
}
/** What the last Pay Now sent (mock mode keeps it for the spec). */
const lastCheckout = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem('firmivra-mock:last-checkout') ?? 'null'));
const mockDone = (page: Page) =>
  expect(page.getByRole('status').filter({ hasText: 'Mock data: the checkout' })).toBeVisible();

test('a tip at Pay Now: a percentage of the amount due, with the total charged', async ({
  page,
}, info) => {
  await invoices(page, true);
  await page.getByRole('button', { name: 'Pay INV-2026-0102 now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a tip?' });
  await expect(dialog).toContainText('INV-2026-0102 · Amount due $450.00');
  const total = dialog.getByTestId('tip-total');
  await expect(total).toContainText('Total charged$450.00');
  await dialog.getByLabel('15% ($67.50)').check();
  await expect(total).toContainText('Tip$67.50');
  await expect(total).toContainText('Total charged$517.50');
  await page.screenshot({ path: info.outputPath('tip-dialog-15.png') });
  await dialog.getByRole('button', { name: 'Continue to Payment' }).click();
  await expect(dialog).toHaveCount(0);
  await mockDone(page);
  expect(await lastCheckout(page)).toEqual({ invoice: 'INV-2026-0102', tipCents: 6_750 });
});

test('a custom tip is checked: an amount, at most the amount due; Cancel sends nothing', async ({
  page,
}) => {
  await invoices(page, true);
  await page.getByRole('button', { name: 'Pay INV-2026-0102 now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a tip?' });
  await dialog.getByLabel('Custom amount').check();
  const amount = dialog.getByLabel('Tip amount ($)');
  const go = dialog.getByRole('button', { name: 'Continue to Payment' });
  await amount.fill('abc');
  await go.click();
  await expect(dialog).toContainText('Enter an amount, like 12.50.');
  await amount.fill('450.01');
  await go.click();
  await expect(dialog).toContainText('The tip can be at most the amount due.');
  expect(await lastCheckout(page)).toBeNull();

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await lastCheckout(page)).toBeNull();

  await page.getByRole('button', { name: 'Pay INV-2026-0102 now' }).click();
  await dialog.getByLabel('Custom amount').check();
  await amount.fill('12.50');
  await expect(dialog.getByTestId('tip-total')).toContainText('Total charged$462.50');
  await go.click();
  await mockDone(page);
  expect(await lastCheckout(page)).toEqual({ invoice: 'INV-2026-0102', tipCents: 1_250 });
});

test('No tip pays the amount due; an invoice without a tip, or Tipping off, skips the question', async ({
  browser,
}) => {
  const on = await browser.newPage();
  await invoices(on, true);
  await on.getByRole('button', { name: 'Pay INV-2026-0102 now' }).click();
  await on
    .getByRole('dialog', { name: 'Add a tip?' })
    .getByRole('button', { name: 'Continue to Payment' })
    .click();
  await mockDone(on);
  expect(await lastCheckout(on)).toEqual({ invoice: 'INV-2026-0102', tipCents: 0 });
  // INV-2026-0101 does not allow a tip: straight to checkout.
  await on.getByRole('button', { name: 'Pay INV-2026-0101 now' }).click();
  await expect(on.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => lastCheckout(on)).toEqual({ invoice: 'INV-2026-0101', tipCents: 0 });
  await on.close();

  const off = await browser.newPage();
  await invoices(off, false);
  await off.getByRole('button', { name: 'Pay INV-2026-0102 now' }).click();
  await expect(off.getByRole('dialog')).toHaveCount(0);
  await mockDone(off);
  expect(await lastCheckout(off)).toEqual({ invoice: 'INV-2026-0102', tipCents: 0 });
  await off.close();
});

test('a payment with a tip shows it to the client and the firm', async ({ page }) => {
  // INV-2026-0081 (mock row 6): 250.00 paid with a 37.50 tip.
  const id = '0199b6e1-0000-7000-8000-000000000006';
  await page.goto(portal(`/lvp/invoices/${id}`));
  await expect(page.getByRole('region', { name: 'Payments' })).toContainText(
    '$250.00 + $37.50 tip',
    { timeout: 60_000 },
  );
  await page.goto(app(`/invoices/${id}`));
  await expect(page.getByTestId('invoice-payments')).toContainText('$250.00 + $37.50 tip', {
    timeout: 60_000,
  });
});
