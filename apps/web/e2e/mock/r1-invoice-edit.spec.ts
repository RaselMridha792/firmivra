import { expect, test } from '@playwright/test';

// R1, Invoices Review 2 I-N06: Edit on a sent invoice with nothing paid and on a scheduled one, on
// the same number, with a required reason that shows in the invoice's History; a sent one offers
// "Send the updated invoice to the client" (on). A paid invoice has no Edit. Mock mode as the
// Owner: invoice 1 (INV-2026-0101) is sent and unpaid, 5 is scheduled, 6 is paid. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const invoice = (n: number) => `0199b6e1-0000-7000-8000-${String(n).padStart(12, '0')}`;

test.describe.configure({ timeout: 240_000 });

test('a sent unpaid invoice is edited with a reason, kept in its History', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/invoices/${invoice(1)}`));
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice(1)}/edit$`), { timeout: 60_000 });
  const correction = page.getByTestId('invoice-correction');
  await expect(correction.getByLabel('Send the updated invoice to the client')).toBeChecked();
  await expect(page.getByLabel('Send On')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Draft' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(correction).toContainText('Say why the invoice changes');
  await correction.getByLabel('Reason for the change *').fill('Wrong month on the line (fake)');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice(1)}$`), { timeout: 60_000 });
  await expect(page.getByTestId('invoice-history')).toContainText(
    'Invoice edited: Wrong month on the line (fake)',
  );
});

test('a scheduled invoice asks for a reason but has nothing to send yet; a paid one has no Edit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/invoices/${invoice(5)}/edit`));
  const correction = page.getByTestId('invoice-correction');
  await expect(correction.getByLabel('Reason for the change *')).toBeVisible({ timeout: 60_000 });
  await expect(correction.getByLabel('Send the updated invoice to the client')).toHaveCount(0);

  await page.goto(app(`/invoices/${invoice(6)}`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
});
