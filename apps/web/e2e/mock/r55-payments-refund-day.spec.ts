import { expect, test } from '@playwright/test';

// R55, Dashboard Review 2 (decided Nov 15): a refund counts on the day it is confirmed. In the mock,
// INV-2026-0012 was paid $150.00 by card on Jan 20, 2026 and $25.00 of it refunded on Feb 3: All
// Payments shows the whole payment on Jan 20 and the refund as its own row on Feb 3, and each
// day's "Received in the range, less refunds" follows. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('All Payments: the payment whole on its day, the refund on the day it was confirmed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices/payments?start=2026-02-03&end=2026-02-03'));
  const table = page.getByRole('table', { name: 'Payments' });
  const refund = table.getByRole('row').filter({ hasText: 'INV-2026-0012' });
  await expect(refund).toContainText('-$25.00', { timeout: 60_000 });
  await expect(refund).toContainText('Refunded');
  await expect(page.getByTestId('received')).toContainText('-$25.00');

  await page.goto(app('/invoices/payments?start=2026-01-20&end=2026-01-20'));
  const paid = table.getByRole('row').filter({ hasText: 'INV-2026-0012' });
  await expect(paid).toContainText('$150.00', { timeout: 60_000 });
  await expect(paid).toContainText('Received');
  await expect(page.getByTestId('received')).toContainText('$150.00');
});
