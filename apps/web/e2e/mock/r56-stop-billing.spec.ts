import { expect, test } from '@playwright/test';

// SH10 (Octavia's Oct 25 review: PY-F13, and Bookkeeping's pause): Stop Future Billing is its own
// action, apart from Pause: the next billing date by default, a confirmation, then Resume; it
// never pauses the service and never touches invoices. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Payroll: stop future billing from the next billing date, then resume it', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Stop Future Billing' }).click();
  const dialog = page.getByTestId('stop-billing');
  const date = dialog.getByLabel('Billing stops on');
  await expect(date).not.toHaveValue('');
  const stop = page.getByRole('button', { name: 'Stop Future Billing' });
  await expect(stop).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await stop.click();
  await expect(page.getByText(/^Payroll billing for Green Leaf Café LLC stops on /)).toBeVisible();

  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Stop Future Billing' }).click();
  await expect(page.getByTestId('stop-billing')).toContainText(/Stops on /);
  await page.getByRole('button', { name: 'Resume Billing' }).click();
  await expect(page.getByText('Payroll billing for Green Leaf Café LLC continues.')).toBeVisible();
});

test('Pause says billing continues; Bookkeeping has the same separate action', async ({ page }) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Pause Payroll Service' }).click();
  await expect(
    page.getByText(/billing continues: Stop Future Billing is a separate action/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Stop Future Billing' }).click();
  await expect(page.getByTestId('stop-billing')).toContainText('Next billing date');
  await expect(page.getByTestId('stop-billing')).toContainText('nothing is charged or refunded');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('stop-billing')).toHaveCount(0);
});
