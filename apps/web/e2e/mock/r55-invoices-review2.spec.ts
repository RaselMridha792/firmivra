import { expect, test, type Locator } from '@playwright/test';

// R55, Octavia's Invoices & Payments Review Two, batch 1. Mock mode as the Owner (the portal as
// mocks/invoices.ts' client 1); synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
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
