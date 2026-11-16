import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F13: Settings > Payments shows Invoice
// Defaults, Reminders & Automations and Taxes & Fees, every option off until the firm turns it
// on; Save Changes validates, Cancel restores, Reset to Default asks first. Mock mode, as Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('the billing sections save, validate, cancel and reset with a confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  for (const title of ['Invoice Defaults', 'Reminders & Automations', 'Taxes & Fees']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  for (const name of ['Payment reminders', 'Automatic receipts', 'Late fee', 'Tipping']) {
    await expect(page.getByRole('switch', { name })).not.toBeChecked();
  }
  await expect(page.getByText('No taxes yet. Add the rates your firm charges.')).toBeVisible();
  // The billing sections' own buttons (Accepted Client Payments above has its own, PAY-3).
  const actions = page.getByTestId('billing-actions');
  const save = actions.getByRole('button', { name: 'Save Changes' });
  await expect(save).toBeDisabled();

  // A late fee needs its value before it can be saved.
  await page.getByRole('switch', { name: 'Late fee' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'late fee' })).toHaveText(
    'Enter the late fee percentage',
  );
  await expect(save).toBeDisabled();
  await page.getByLabel('Percent of the balance').fill('1.5');
  await page.getByRole('switch', { name: 'Automatic receipts' }).click();
  await page.getByLabel('Invoice number prefix').fill('LVP-');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Automatic receipts' })).toBeChecked();

  // Cancel restores the saved values.
  await page.getByRole('switch', { name: 'Tipping' }).click();
  await actions.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('switch', { name: 'Tipping' })).not.toBeChecked();

  // Taxes are configured here, never fixed.
  await page.getByLabel('Tax name').fill('Fake State Tax');
  await page.getByLabel('Rate (%)').fill('6.25');
  await page.getByRole('button', { name: 'Add Tax' }).click();
  await expect(page.getByRole('region', { name: 'Taxes', exact: true })).toContainText(
    'Fake State Tax6.25%',
  );
  await page.getByRole('heading', { name: 'Taxes & Fees' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/invoices/payment-preferences.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Reset to Default' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset billing settings to default?' });
  await expect(dialog).toContainText('Your tax rates and templates stay.');
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('switch', { name: 'Automatic receipts' })).not.toBeChecked();
  await expect(page.getByLabel('Invoice number prefix')).toHaveValue('INV-');
});

test('I-N04: reminders on several days before the due date, and a cap on overdue notices', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  await page.getByRole('switch', { name: 'Payment reminders' }).click({ timeout: 60_000 });
  const days = page.getByTestId('reminder-days');
  await expect(days.getByRole('listitem')).toHaveText(['3 days before']);
  const add = async (n: string) => {
    await days.getByLabel('Days before', { exact: true }).fill(n);
    await days.getByRole('button', { name: 'Add day' }).click();
  };
  await add('7');
  await add('0');
  await expect(days.getByRole('listitem')).toHaveText([
    '7 days before',
    '3 days before',
    'On the due date',
  ]);
  await days.getByLabel('Days before', { exact: true }).fill('7');
  await expect(days.getByRole('alert')).toHaveText('7 is in the list already.');
  await days.getByRole('button', { name: 'Remove 3 days before' }).click();
  await page.getByRole('switch', { name: 'Overdue notices' }).click();
  await page.getByLabel('Stop after (notices)').fill('4');
  const save = page.getByTestId('billing-actions').getByRole('button', { name: 'Save Changes' });
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  await expect(days.getByRole('listitem')).toHaveText(['7 days before', 'On the due date']);
  await expect(page.getByLabel('Stop after (notices)')).toHaveValue('4');
});
