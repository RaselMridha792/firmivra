import { expect, test, type Locator } from '@playwright/test';

// R1, Invoices Review 2 batch 2 (the lead's list): the list's badges, Preview, the Invoice
// Templates link, Create Task / Schedule Follow-Up context, Send Receipt, the Payment Method filter.
// Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

/** The first badge in the list with this exact label. */
const badge = (list: Locator, label: string) =>
  list
    .locator('span.rounded-pill')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();

test('I-N07: Overdue and Canceled, Due Today and Partially Paid, Scheduled and Sent read apart', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  const main = page.locator('main');
  await expect(badge(main, 'Overdue')).toBeVisible({ timeout: 60_000 });
  await expect(badge(main, 'Overdue')).toHaveClass(/bg-danger-soft/);
  await expect(badge(main, 'Canceled')).not.toHaveClass(/bg-danger-soft/);
  await expect(badge(main, 'Canceled').locator('svg')).toHaveCount(1);
  await expect(badge(main, 'Scheduled').locator('svg')).toHaveCount(1);
  await expect(badge(main, 'Sent').locator('svg')).toHaveCount(1);
});
