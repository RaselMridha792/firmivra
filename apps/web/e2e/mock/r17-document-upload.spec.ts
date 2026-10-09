import { expect, test } from '@playwright/test';

// N05 upload pop-up and document requests in mock mode (mocks/documents.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const pdf = {
  name: 'Sample_W-2.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 sample'),
};

test('a client uploads a file through the pop-up and sees it being checked', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/documents'));
  await page.getByRole('button', { name: 'Upload Documents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Documents' });
  await expect(dialog.getByText('STOP.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('upload-1440.png') });

  await dialog.getByRole('button', { name: /Upload more tax documents/ }).click();
  await dialog.getByLabel('File').setInputFiles(pdf);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sample_W-2.pdf was uploaded' }),
  ).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Sample_W-2.pdf' });
  await expect(row.getByText('Checking…')).toBeVisible();
});

test('a wrong file type is refused before anything is sent', async ({ page }) => {
  await page.goto(portal('/lvp/documents'));
  await page.getByRole('button', { name: 'Upload Documents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Documents' });
  await dialog.getByRole('button', { name: /Upload more tax documents/ }).click();
  await dialog
    .getByLabel('File')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Upload a PDF');
});

test("an open request can be answered with I don't have this", async ({ page }) => {
  await page.goto(portal('/lvp/documents'));
  const steps = page.getByRole('region', { name: 'Your Next Steps' });
  await expect(steps).toBeVisible();
  const first = steps
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: "I don't have this" }) })
    .first();
  const title = await first.locator('p').first().innerText();
  const item = steps.getByRole('listitem').filter({ hasText: title });
  await item.getByRole('button', { name: "I don't have this" }).click();
  await item.getByLabel('Tell your firm why').fill('My employer has not sent it yet.');
  await item.getByRole('button', { name: 'Send' }).click();
  await expect(steps.getByRole('listitem').filter({ hasText: title })).toContainText(
    "You don't have it",
  );
});
