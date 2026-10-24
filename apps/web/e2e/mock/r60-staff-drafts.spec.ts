import { expect, test } from '@playwright/test';

// Octavia's SM5 (review of Oct 21 to 22): a staff draft "could not be found or reopened", and a
// chosen file was lost after Back. Mock mode (playwright.mock.config.ts) as the Owner; the mock
// keeps its data in the page, so the test moves between pages by their links. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a saved draft is in the directory under Drafts, reopens with its values, and deletes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  await page.getByLabel('First Name *').fill('Jordan');
  await page.getByLabel('Last Name *').fill('Lee');
  await page.getByLabel('Work Email *').fill('jordan.lee@example.test');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('draft-saved')).toBeVisible();

  await page.getByRole('link', { name: 'Staff Management' }).first().click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('drafts');
  const drafts = page.getByRole('table', { name: 'Staff drafts' });
  const row = drafts.getByRole('row').filter({ hasText: 'Jordan Lee' });
  await expect(row).toContainText('jordan.lee@example.test');
  await expect(row).toContainText('Draft');
  await expect(row).toContainText('Step 1 of 4: Account Information');

  // Continue reopens the step it was saved on, with its values.
  await row.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/team\/new\?draft=/);
  await expect(page.getByLabel('First Name *')).toHaveValue('Jordan');
  await expect(page.getByLabel('Work Email *')).toHaveValue('jordan.lee@example.test');

  // Delete asks first; the draft goes, and no account was ever made.
  await page.getByRole('link', { name: 'Staff Management' }).first().click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('drafts');
  await drafts
    .getByRole('row')
    .filter({ hasText: 'Jordan Lee' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete Draft' })
    .getByRole('button', { name: 'Delete Draft' })
    .click();
  await expect(page.getByTestId('drafts-result')).toHaveText(
    'The draft for Jordan Lee was deleted.',
  );
  await expect(drafts.getByRole('row').filter({ hasText: 'Jordan Lee' })).toHaveCount(0);
});

test('a chosen file and its type stay after Back and Next', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new'));
  await page.getByLabel('First Name *').fill('Riley');
  await page.getByLabel('Last Name *').fill('Moss');
  await page.getByLabel('Work Email *').fill('riley.moss@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'offer-letter.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  const docs = page.getByTestId('staff-documents');
  await expect(docs).toContainText('offer-letter.pdf');
  await docs
    .getByRole('combobox', { name: 'Document type of offer-letter.pdf' })
    .selectOption({ index: 1 });
  const type = await docs
    .getByRole('combobox', { name: 'Document type of offer-letter.pdf' })
    .inputValue();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
  await expect(docs).toContainText('offer-letter.pdf');
  await expect(
    docs.getByRole('combobox', { name: 'Document type of offer-letter.pdf' }),
  ).toHaveValue(type);
});
