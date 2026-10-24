import { expect, test, type Page } from '@playwright/test';

// R56: Upload Document (Documents design, Frame 1; `api.documentLibrary` over the documents
// mock). Files, whose they are and how to file them, per-file details, then Review & Upload; the
// library lists the new document. Lead and Firm uploads wait for their records (no lead or
// firm-only documents in the database yet). Synthetic files only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% synthetic test file\n'),
});

async function start(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/upload'));
  await expect(page.getByTestId('upload-dropzone')).toBeVisible({ timeout: 60_000 });
}

test('Upload Document: files, client, type and folder, details, then upload', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('radio', { name: /Lead/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Firm/ })).toBeDisabled();

  // Nothing chosen: the step says what is missing and stays.
  await page.getByRole('button', { name: /Next: Document Details/ }).click();
  await expect(page.getByTestId('upload-dropzone')).toBeVisible();
  await expect(page.getByText('Choose at least one file.')).toBeVisible();

  await page
    .getByTestId('upload-dropzone')
    .locator('input[type=file]')
    .setInputFiles([pdf('Sample_2025_Return.pdf')]);
  const chosen = page.getByRole('list', { name: 'Selected files' });
  await expect(chosen).toContainText('Sample_2025_Return.pdf');

  await page.getByRole('button', { name: /Client \/ Lead/ }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a client' });
  await picker.getByPlaceholder('Search by name, email or phone…').fill('Jamie');
  await picker.getByRole('button', { name: /Jamie Sample/ }).click();
  await page.getByLabel('Document Type *').selectOption({ index: 1 });
  await page.getByLabel('Folder *').first().selectOption({ index: 1 });
  await page.getByLabel('Description (optional)').fill('Synthetic return for review.');

  await page.getByRole('button', { name: /Next: Document Details/ }).click();
  const files = page.getByRole('list', { name: 'Files' });
  await expect(files).toBeVisible();
  await expect(files.getByLabel('Document Name *').first()).toHaveValue(/Sample_2025_Return/);
  const service = files.getByLabel('Service *').first();
  await expect(service).toBeEnabled();
  if (!(await service.inputValue())) await service.selectOption({ index: 1 });

  await page.getByRole('button', { name: /Next: Organize & Assign/ }).click();
  await page.getByRole('button', { name: /Next: Review & Upload/ }).click();
  await page.getByRole('button', { name: 'Upload Document' }).click();
  await expect(page.getByText(/The document was uploaded to/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Back to Documents' }).last().click();
  await expect(page).toHaveURL(/\/documents$/);
});

test('Upload Document refuses a file type the documents API does not take', async ({ page }) => {
  await start(page);
  await page
    .getByTestId('upload-dropzone')
    .locator('input[type=file]')
    .setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') },
    ]);
  await expect(page.getByRole('list', { name: 'Selected files' })).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toContainText(/notes\.txt/);
});
