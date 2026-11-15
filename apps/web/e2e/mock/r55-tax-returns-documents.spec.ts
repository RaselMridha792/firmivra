import { expect, type Page, test } from '@playwright/test';

// Tax Returns Review 2, a return's Intake & Documents: Upload Documents works on the return
// itself, and the file it links is the client's own document. Mock mode
// (playwright.mock.config.ts) as the Owner, the mocks answering as the API does: a new upload is
// checked for a few seconds before it can be opened. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const season = String(new Date().getFullYear() - 1);

test.describe.configure({ timeout: 180_000 });

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 synthetic draft return'),
});

/** Opens the client's return for last season on Intake & Documents; its address. */
async function openDocuments(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/tax-returns?year=${season}&q=Morgan%20Testwell`));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Intake & Documents' }).click({ timeout: 60_000 });
  await expect(page.getByTestId('return-documents')).toBeVisible();
  return page.url();
}

/** Upload Documents on the return, with what it fills in checked first. */
async function uploadHere(page: Page, name: string) {
  await page.getByRole('button', { name: 'Upload Documents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Document' });
  const form = dialog.getByTestId('upload-document');
  await expect(form).toContainText('Tax Returns');
  await expect(form).toContainText('Morgan Testwell');
  await expect(form.getByLabel('Tax year')).toHaveValue(season);
  await expect(
    form.getByLabel(`Link to the ${season} return as`).locator('option:checked'),
  ).toHaveText(/Draft/);
  await form.getByLabel('File').setInputFiles(pdf(name));
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(
    page.getByText(`Uploaded ${name} to Morgan Testwell's Tax Returns documents.`),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

// Tax Returns Review 2 (F08): the upload happens on the return, prefilled, and links that file.
test('Upload Documents on a return works in place, prefilled, and links the uploaded file to the return', async ({
  page,
}) => {
  const here = await openDocuments(page);
  const name = 'Fake_Draft_Return_F08.pdf';
  await uploadHere(page, name);
  await expect(page).toHaveURL(here);
  // The return lists the file under its own name, as a Draft.
  const linked = page
    .getByTestId('return-documents')
    .getByRole('listitem')
    .filter({ hasText: name });
  await expect(linked).toHaveCount(1);
  await expect(linked).toContainText('Draft');
  // It is the client's one document of that name, for the return's year: not a copy.
  await page.getByTestId('return-documents').getByRole('button', { name: 'Link Document' }).click();
  const choices = page.getByTestId('link-doc-dialog').getByLabel('Document').locator('option');
  await expect(choices.filter({ hasText: name })).toHaveText([`${name} (${season})`]);
});

// Tax Returns Review 2 (F09a): a file uploaded from the return opens from the return's Documents.
test('a file uploaded from the return is linked to it and opens from the return’s Documents', async ({
  page,
}) => {
  // The page's clock, so the new file's malware check (a few seconds) and the list's refresh
  // can be moved on instead of waited for.
  await page.clock.install();
  await openDocuments(page);
  const name = 'Fake_Draft_Return_F09.pdf';
  await uploadHere(page, name);
  const docs = page.getByTestId('return-documents');
  const open = docs.getByRole('button', { name, exact: true });
  // Still being checked, as the client's document is: it cannot be opened yet.
  await expect(docs.getByRole('listitem').filter({ hasText: name })).toContainText('Scanning');
  await expect(open).toBeDisabled();

  await page.clock.fastForward('00:40');
  // The Preparation tab lists the return's drafts again, read afresh.
  await page.getByRole('tab', { name: 'Preparation' }).click();
  const draft = page.getByTestId('return-documents').getByRole('button', { name, exact: true });
  await expect(draft).toBeEnabled({ timeout: 30_000 });
  await draft.click();
  // The link is the client's own file's: the documents mock gives one only for a clean file.
  await expect(page.getByText('Download ready.')).toBeVisible();
});
