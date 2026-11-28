// Q28 A-X10 part 3: the Resources screen of Business Advisory. Owner and Admin add the firm's own
// resources (a link, or an uploaded file, checked for viruses before it opens or is sent), edit
// any (a built-in one as the firm's copy, "Edited") and archive the firm's own after a
// confirmation; Staff see the library but none of that. Mock mode (a file is clean at once), as
// the firm's Owner and as Staff. Synthetic data.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

test('A-X10: Owner adds a link resource and a file resource, then archives one', async ({
  page,
}) => {
  await page.goto(app('/business-advisory/resources'));
  const library = page.getByTestId('ba-resources');
  await expect(library.getByText('Brand Basics Guide')).toBeVisible({ timeout: 60_000 });

  // A link: the type Link asks for its https link.
  await page.getByRole('button', { name: 'Add Resource' }).click();
  const dialog = page.getByTestId('resource-dialog');
  await dialog.getByLabel('Title').fill('Local Grant Programs (sample)');
  await dialog.getByLabel('Category').selectOption('Funding');
  await dialog.getByLabel('Type').selectOption('LINK');
  await dialog.getByLabel('What the client gets').fill('Small-business grants near you (sample).');
  const add = page.getByRole('button', { name: 'Add Resource' }).last();
  await expect(add).toBeDisabled();
  await dialog.getByLabel('Link address').fill('https://example.com/grants');
  await add.click();
  await expect(page.getByText('Local Grant Programs (sample) saved.')).toBeVisible();
  const link = library.getByRole('listitem').filter({ hasText: 'Local Grant Programs (sample)' });
  await expect(link).toContainText('Firm resource');
  await expect(link.getByRole('link', { name: /Open/ })).toHaveAttribute(
    'href',
    'https://example.com/grants',
  );

  // A file: uploaded, then offered once clean (Open file).
  await page.getByRole('button', { name: 'Add Resource' }).click();
  await dialog.getByLabel('Title').fill('First Hire Checklist (sample)');
  await dialog.getByLabel('Category').selectOption('Growth / Operations');
  await dialog.getByLabel('Type').selectOption('CHECKLIST');
  await dialog.getByLabel('What the client gets').fill('Before your first employee starts.');
  await dialog.getByRole('radio', { name: 'Upload a file' }).check();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'First hire checklist.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(dialog).toContainText('Chosen: First hire checklist.pdf');
  await page.getByRole('button', { name: 'Add Resource' }).last().click();
  await expect(page.getByText('First Hire Checklist (sample) saved.')).toBeVisible();
  const withFile = library
    .getByRole('listitem')
    .filter({ hasText: 'First Hire Checklist (sample)' });
  await expect(
    withFile.getByRole('button', { name: 'Open First hire checklist.pdf' }),
  ).toBeVisible();
  await expect(withFile.getByRole('button', { name: /Send .* to a client/ })).toBeVisible();

  // Archive asks first; then it leaves the library.
  await link.getByRole('button', { name: 'Archive Local Grant Programs (sample)' }).click();
  await expect(page.getByRole('dialog')).toContainText('Archive Local Grant Programs (sample)?');
  await page.getByTestId('confirm-action').click();
  await expect(page.getByText('Local Grant Programs (sample) archived.')).toBeVisible();
  await expect(link).toHaveCount(0);
});

test('A-X10: a built-in resource is edited as the firm’s copy and is never archived', async ({
  page,
}) => {
  await page.goto(app('/business-advisory/resources'));
  const library = page.getByTestId('ba-resources');
  const row = library.getByRole('listitem').filter({ hasText: 'Website Launch Checklist' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByRole('button', { name: /Archive/ })).toHaveCount(0);
  await row.getByRole('button', { name: 'Edit Website Launch Checklist' }).click();
  const dialog = page.getByTestId('resource-dialog');
  await expect(page.getByRole('dialog')).toContainText('your firm’s own copy');
  await expect(dialog.getByLabel('Title')).toHaveValue('Website Launch Checklist');
  await dialog.getByLabel('Title').fill('Website Launch Checklist (firm copy)');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Website Launch Checklist (firm copy) saved.')).toBeVisible();
  const edited = library
    .getByRole('listitem')
    .filter({ hasText: 'Website Launch Checklist (firm copy)' });
  await expect(edited).toContainText('Edited');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('A-X10: Staff see the library but cannot add, edit or archive', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-role', 'STAFF'));
  await page.goto(app('/business-advisory/resources'));
  const library = page.getByTestId('ba-resources');
  await expect(library.getByText('Brand Basics Guide')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Add Resource' })).toHaveCount(0);
  await expect(library.getByRole('button', { name: /^Edit / })).toHaveCount(0);
  await expect(library.getByRole('button', { name: /^Archive / })).toHaveCount(0);
});
