import { expect, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F28 and F29: the Federal & State Summary has a
// visible Add or Edit Amount per jurisdiction. An amount is a refund or an amount due (never a
// signed number), estimated or final, and names its source; each change is a new version, and an
// empty amount clears it. In mock mode (playwright.mock.config.ts) as the Owner, with the mock
// answering as the API does. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a jurisdiction’s amount is recorded with its source, versioned and cleared', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('IN_PREPARATION');
  await page.getByTestId('return-link').first().click();
  await page.getByRole('tab', { name: 'Payments & Refunds' }).click();
  const summary = page.getByTestId('summary');
  const federal = summary.getByRole('row').filter({ hasText: 'Federal' });
  await expect(federal).toContainText('Staff estimate · v1');

  await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit Federal Amount' })).toBeVisible();
  await dialog.getByLabel('Refund or amount due').selectOption('due');
  await dialog.getByLabel('Amount ($)').fill('1250.50');
  await dialog.getByLabel('Status').selectOption('FINAL');
  await dialog.getByLabel('Source').selectOption('TAX_SOFTWARE');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Amount saved.')).toBeVisible();
  await expect(federal).toContainText('Federal Amount Due');
  await expect(federal).toContainText('$1,250.50');
  await expect(federal).toContainText('Final');
  await expect(federal).toContainText('Tax software · v2');

  await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
  await dialog.getByLabel('Amount ($)').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(federal.getByRole('button', { name: 'Add the Federal amount' })).toBeVisible();
  await expect(federal).not.toContainText('Tax software');
});

test('Save waits for the source of a new amount', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('IN_PREPARATION');
  await page.getByTestId('return-link').first().click();
  await page.getByRole('tab', { name: 'Payments & Refunds' }).click();
  const federal = page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' });
  await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Source').selectOption('');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('Source').selectOption('AGENCY_NOTICE');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
});
