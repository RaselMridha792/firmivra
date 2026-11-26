import { expect, test } from '@playwright/test';

// #36 Q24 (I-N03), in mock mode (mocks/invoices.ts): a Scheduled invoice has Send Now, on its page
// and in the list's menu; a sent invoice with something to pay has Resend, Send Reminder and Copy
// Payment Link on its page as in the list; Staff can preview an invoice but not send it.
// Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Send Now opens a scheduled invoice from its page', async ({ page }) => {
  // INV-2026-0106 (mock row 5): scheduled.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000005'));
  await expect(page.getByTestId('page-title')).toHaveText('INV-2026-0106', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Send Now' }).click();
  await expect(page.getByTestId('invoice-notice')).toHaveText('INV-2026-0106 sent to the client.');
  await expect(page.getByRole('button', { name: 'Send Now' })).toHaveCount(0);
  // Now sent with all of it to pay: Resend instead.
  await expect(page.getByRole('button', { name: 'Resend' })).toBeVisible();
});

test('the list offers Send Now on a scheduled invoice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/invoices'));
  await page.getByLabel('Search invoices').fill('0106');
  await page.getByRole('button', { name: 'Actions for INV-2026-0106' }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Send Now' }).click();
  await expect(page.getByText('INV-2026-0106 sent.')).toBeVisible();
});

test('a sent invoice with a balance: Resend, Send Reminder and Copy Payment Link on its page', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // INV-2026-0098 (mock row 3): sent, overdue, nothing paid.
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000003'));
  await expect(page.getByTestId('page-title')).toHaveText('INV-2026-0098', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Send Now' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Resend' }).click();
  await expect(page.getByTestId('invoice-notice')).toHaveText(
    'INV-2026-0098 sent to the client again.',
  );

  await page.getByRole('button', { name: 'Send Reminder' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/Subject/)).toHaveValue(/^Reminder: invoice INV-2026-0098, \$/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Copy Payment Link' }).click();
  await expect(page.getByTestId('invoice-notice')).toContainText('Payment link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/lvp\/invoices\/0199b6e1-0000-7000-8000-000000000003$/,
  );
});

test('Staff can preview an invoice but not send it', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-role', 'STAFF'));
  await page.goto(app('/invoices/0199b6e1-0000-7000-8000-000000000003'));
  await expect(page.getByTestId('page-title')).toHaveText('INV-2026-0098', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send Reminder' })).toHaveCount(0);
});
