import { expect, test } from '@playwright/test';

// R60, Payroll Review 2 cross-check (Nov 15): B01, a saved report shows its attached file by
// name (it was screen-reader only), and UX02, View opens the file's own page and Download
// downloads it. Mock mode as the Owner on Green Leaf Café's payroll workspace. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';
const FILE = 'Fake_B01_register.pdf';

test.describe.configure({ timeout: 180_000 });

test('a report shows its file by name; View opens it and Download downloads it (B01, UX02)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=documents`);
  const documents = page.getByTestId('tab-documents');
  await documents.getByRole('button', { name: 'Upload Document' }).click({ timeout: 60_000 });
  await page
    .getByTestId('upload-document')
    .locator('input[type=file]')
    .setInputFiles({
      name: FILE,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n'),
    });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const row = page.getByTestId('payroll-document').filter({ hasText: FILE });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // B01: attach it as a report; the Reports table names the file.
  await page.getByRole('tab', { name: 'Reports' }).click();
  await page
    .getByTestId('tab-reports')
    .getByRole('button', { name: /Add Report/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add Report' });
  await dialog.getByLabel('Period start').fill('2026-10-01');
  await dialog.getByLabel('Period end').fill('2026-10-31');
  await dialog.getByLabel('Document').selectOption({ label: FILE });
  await dialog.getByRole('button', { name: 'Add Report' }).click();
  await expect(dialog).toBeHidden();
  const name = page.getByTestId('report-file-name').filter({ hasText: FILE });
  await expect(name).toBeVisible({ timeout: 30_000 });

  // UX02: Download downloads the file (once its scan is clean), under its own name.
  const download = page.getByRole('button', { name: `Download ${FILE}` }).first();
  await expect(download).toBeEnabled({ timeout: 60_000 });
  // The mock's scan takes four seconds after the upload.
  await page.waitForTimeout(4500);
  const downloading = page.waitForEvent('download', { timeout: 20_000 });
  await download.click();
  const failed = page.getByText('The file could not be downloaded');
  const file = await downloading.catch(async (e: unknown) => {
    throw new Error(`no download (alert shown: ${await failed.isVisible()}): ${String(e)}`);
  });
  expect(file.suggestedFilename()).toBe(FILE);

  // UX02: View opens the file's own page.
  await page
    .getByRole('link', { name: `View ${FILE}` })
    .first()
    .click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByText(FILE).first()).toBeVisible({ timeout: 60_000 });
});
