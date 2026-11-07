import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F16 (playwright.mock.config.ts, as an Owner; the mock
// answers as the API): Import Template takes a Word document for a formatted kind (not SMS),
// states the types and limit, and makes a private draft. The API converts, cleans and discards it.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The API's synthetic fixture: a heading, merge fields, links.
const docx = readFileSync(
  new URL('../../../api/test/fixtures/import-sample.docx', import.meta.url),
);

test('a Word document imports as a private draft; an SMS offers no Word option (TP-F16)', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  await page.getByRole('button', { name: 'Import Template' }).click();
  const form = page.getByTestId('import-form');
  await form.getByLabel('Kind').selectOption({ label: 'SMS' });
  await expect(form.getByLabel('Format').locator('option')).toHaveText(['HTML', 'Plain text']);

  await form.getByLabel('Kind').selectOption({ label: 'Email' });
  await form.getByLabel('Format').selectOption('DOCX');
  await expect(form.getByTestId('import-docx')).toContainText('A .docx file up to 10 MB');
  await form.getByLabel('Template name').fill('Welcome letter (Word)');
  await form
    .getByTestId('import-docx')
    .locator('input[type="file"]')
    .setInputFiles({ name: 'welcome.docx', mimeType: DOCX, buffer: docx });
  await expect(form.getByTestId('import-file')).toHaveText('welcome.docx');
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(
    page.getByText('Welcome letter (Word) imported as a draft.').filter({ visible: true }),
  ).toBeVisible();
  await page.getByPlaceholder('Search templates...').fill('Welcome letter (Word)');
  await expect(
    page.getByRole('link', { name: 'Welcome letter (Word)', exact: true }),
  ).toBeVisible();
});
