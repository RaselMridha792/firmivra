import { expect, test } from '@playwright/test';

// Tax Returns Review 2, a jurisdiction's amount on Payments & Refunds. Mock mode
// (playwright.mock.config.ts) as the Owner, the mock answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

// Tax Returns Review 2 (F29): a negative amount or text is refused; extra decimals go to cents.
test('an amount below zero or in words cannot be saved, and 2.345 is saved as 2.35', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?q=Jamie%20Sample'));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Payments & Refunds' }).click({ timeout: 60_000 });
  const federal = page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' });
  await federal.getByRole('button', { name: /^(Add|Edit) the Federal amount$/ }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('amount-dialog') });
  const amount = dialog.getByLabel('Amount ($)');
  const save = dialog.getByRole('button', { name: 'Save' });
  await dialog.getByLabel('Refund or amount due').selectOption('refund');
  await dialog.getByLabel('Source').selectOption('STAFF_ESTIMATE');

  for (const refused of ['-1', 'abc']) {
    await amount.fill(refused);
    await expect(save, refused).toBeDisabled();
    await expect(dialog.getByText('Enter an amount of zero or more')).toBeVisible();
  }
  await amount.fill('2.345');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Amount saved.')).toBeVisible();
  await expect(federal).toContainText('$2.35');
  await expect(federal).not.toContainText('2.345');
  // Opened again, it reads 2.35: the cents were saved, not the third decimal.
  await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
  await expect(amount).toHaveValue('2.35');
});
