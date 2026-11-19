import { expect, test, type Locator } from '@playwright/test';

// R55, Octavia's Invoices & Payments Review Two, batch 1. Mock mode as the Owner (the portal as
// mocks/invoices.ts' client 1); synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

/** The first badge in this place with exactly this label. */
const badge = (place: Locator, label: string) =>
  place
    .locator('span.rounded-pill')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
/** A whole class name (`bg-navy`, never `bg-navy-soft`). */
const cls = (name: string) => new RegExp(`(^|\\s)${name}(\\s|$)`);

test('I-N07: the client portal shows Canceled in the same solid navy as the firm', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/invoices'));
  await page.getByLabel('Show').selectOption('CANCELED', { timeout: 60_000 });
  const canceled = badge(page.locator('main'), 'Canceled');
  await expect(canceled).toHaveClass(cls('bg-navy'));
  await expect(canceled).toHaveClass(cls('text-white'));
});

test('I-D01: an invoice set to ask for payment before the due date asks for nothing, in the firm or the portal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // INV-2026-0101 was set to ask before I-D01 withdrew the option (mocks/invoices.ts).
  const id = '0199b6e1-0000-7000-8000-000000000001';
  await page.goto(app(`/invoices/${id}`));
  await expect(page.locator('main')).toContainText('INV-2026-0101', { timeout: 60_000 });
  const detail = page.getByTestId('invoice-detail');
  await expect(detail).toContainText('Email to Client');
  await expect(detail).not.toContainText('before the due date');

  await page.goto(portal(`/lvp/invoices/${id}`));
  await expect(page.locator('main')).toContainText('INV-2026-0101', { timeout: 60_000 });
  // Paying early stays possible: Pay Now is there as on any open invoice.
  await expect(page.getByRole('button', { name: /Pay/ }).first()).toBeVisible();
  await expect(page.getByTestId('pay-before-due')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('before the due date');
});

test('R1-2: leaving Accepted Client Payments with unsaved changes asks to stay or leave', async ({
  page,
}) => {
  // This tab's mock firm has Stripe connected, so the cards switch can change.
  await page.addInitScript(() =>
    sessionStorage.setItem('firmivra-mock:payments-stage', 'CONNECTED'),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/payments'));
  const cards = page
    .getByTestId('accepted-payments')
    .getByRole('switch', { name: 'Credit / debit cards' });
  await expect(cards).toBeEnabled({ timeout: 60_000 });
  await expect(cards).toBeChecked();
  await cards.click();
  await expect(cards).not.toBeChecked();

  const away = page.locator('main').getByRole('link', { name: 'Invoices & Payments' }).last();
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
  await away.click();
  await expect(ask).toContainText('You have changes that are not saved.');
  await ask.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings\/payments$/);
  await expect(cards).not.toBeChecked();

  await away.click();
  await ask.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).toHaveURL(/\/invoices$/, { timeout: 60_000 });
});

test('R1-2: the billing sections ask too; after Cancel nothing is asked', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/payments'));
  const prefix = page.getByLabel('Invoice number prefix');
  await prefix.fill('LVP-', { timeout: 60_000 });
  const away = page.locator('main').getByRole('link', { name: 'Invoices & Payments' }).last();
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
  await away.click();
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(prefix).toHaveValue('LVP-');

  // Closing or reloading the tab asks too (the browser's own question); this one stays.
  const asked = new Promise<string>((resolve) => {
    page.once('dialog', (dialog) => {
      resolve(dialog.type());
      void dialog.dismiss();
    });
  });
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');

  await page.getByTestId('billing-actions').getByRole('button', { name: 'Cancel' }).click();
  await expect(prefix).toHaveValue('INV-');
  await away.click();
  await expect(page).toHaveURL(/\/invoices$/, { timeout: 60_000 });
  await expect(ask).toHaveCount(0);
});
