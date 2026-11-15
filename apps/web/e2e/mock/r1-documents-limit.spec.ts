import { expect, test } from '@playwright/test';

// R1, DOCUMENTS-LIMIT-01 (Intake Forms Review Two): the upload screens show and check the firm's
// own document limit (Documents > Settings > File Settings), not the platform's 100 MB; the mock's
// upload tickets refuse a larger file as the API does. Mock mode as the Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

test('a 20 MB firm limit shows on Quick Upload and Upload Document, and a 21 MB file is refused', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents/settings'));
  await expect(page.getByTestId('document-settings')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'File Settings' }).click();
  await page.getByLabel('Largest file').selectOption('20');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Document settings were saved.')).toBeVisible();

  // In the same session (the mock keeps the setting): Documents, then Upload Document.
  await page.locator('nav').getByRole('link', { name: 'Documents', exact: true }).first().click();
  const card = page.getByTestId('quick-upload-card');
  await expect(card).toContainText('(Max 20 MB per file)', { timeout: 60_000 });
  await card.getByTestId('quick-upload-dropzone').click();
  await expect(page).toHaveURL(/\/documents\/upload$/, { timeout: 60_000 });
  await expect(page.getByText('(Max 20 MB per file)')).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'too-big-fake.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(21 * 1024 * 1024, 1),
    });
  await expect(page.getByText(/too-big-fake\.pdf: use .* up to 20 MB\./)).toBeVisible();
});
