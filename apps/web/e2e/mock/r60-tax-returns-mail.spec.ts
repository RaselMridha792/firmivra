import { expect, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F26: a paper filing is logged as mailed only with
// its Mail Tracking Number, shown where an e-filed return shows its submission id. In mock mode
// (playwright.mock.config.ts) as the Owner, with the mock answering as the API does. Synthetic.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Record Paper Filing waits for the Mail Tracking Number and shows it', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('IN_PREPARATION');
  await page.getByTestId('return-link').first().click();
  await page.getByRole('tab', { name: 'E-File' }).click();
  const efile = page.getByTestId('efile');
  await efile.getByRole('button', { name: 'Jurisdictions' }).click();
  await page.getByLabel('Federal filing method').selectOption('PAPER');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  const federal = efile.getByTestId('filing-US');
  await federal.getByRole('button', { name: 'Record Paper Filing' }).click();
  const record = page.getByRole('dialog').getByRole('button', { name: 'Record' });
  await expect(record).toBeDisabled();
  await page.getByTestId('paper-dialog').getByLabel('Mail Tracking Number').fill('FAKE 9400 0001');
  await record.click();
  await expect(page.getByText('Paper filing recorded.')).toBeVisible();
  await expect(federal).toContainText('Mail Tracking Number');
  await expect(federal).toContainText('FAKE 9400 0001');
});
