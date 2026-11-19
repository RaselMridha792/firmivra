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
