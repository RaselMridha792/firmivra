import { expect, test, type Page } from '@playwright/test';

// R56: Document Details (Documents design, Frame 2) in mock mode: `api.documentLibrary`'s
// details, preview, versions, activity, update, review, archive and trash. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;
const doc = (n: number) => `0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`;

async function open(page: Page, n: number) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/documents/${doc(n)}`));
  await expect(page.getByTestId('document-file')).toBeVisible({ timeout: 60_000 });
}

test('the file, its preview, its information, versions and activity', async ({ page }) => {
  await open(page, 6);
  await expect(page.getByTestId('document-file')).toContainText('Tax_Return_2024.pdf');
  await expect(page.getByTestId('document-file')).toContainText('Completed');
  // The bundled sample PDF draws with the viewer's toolbar.
  const viewer = page.getByTestId('document-viewer');
  await expect(viewer.getByTestId('viewer-pages')).toHaveText('2', { timeout: 30_000 });
  await viewer.getByRole('button', { name: 'Zoom in' }).click();
  await expect(viewer.getByTestId('viewer-zoom')).toHaveText('125%');
  await viewer.getByRole('button', { name: 'Fit to width' }).click();
  await expect(viewer.getByTestId('viewer-zoom')).toHaveText('100%');

  const info = page.getByTestId('document-info');
  await expect(info).toContainText('Jamie Sample');
  await expect(info).toContainText('jamie.sample@example.test');
  await expect(page.getByTestId('document-versions')).toContainText('Current');
  await expect(page.getByTestId('document-activity')).toContainText('Document uploaded');
  // Notes, related forms and appointments have no link to a document yet: shown off.
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add Note' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Share' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${doc(6)}/share$`));
});

test('edit details, add a tag, review, archive and trash', async ({ page }) => {
  await open(page, 1);
  await page.getByRole('button', { name: 'Edit Details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Document Name *').fill('W-2_2025_Employer.pdf');
  await dialog.getByLabel('Description').fill('Fake: the employer copy.');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('The details were saved.')).toBeVisible();
  await expect(page.getByTestId('document-info')).toContainText('W-2_2025_Employer.pdf');
  await expect(page.getByTestId('document-info')).toContainText('Fake: the employer copy.');

  await page.getByRole('button', { name: 'Add a tag' }).click();
  await page.getByRole('dialog').getByLabel('Tag *').fill('Fake 2025');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Tag' }).click();
  await expect(page.getByTestId('document-info')).toContainText('Fake 2025');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark Verified' }).click();
  await expect(page.getByTestId('document-file')).toContainText('Verified');
  await expect(page.getByTestId('document-activity')).toContainText('Document marked as verified');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('This document is archived.')).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page.getByText('This document is in Trash.')).toBeVisible();
});

test('a file without a preview says so, and a missing one too', async ({ page }) => {
  await open(page, 9);
  await expect(page.getByTestId('document-viewer')).toContainText(
    'This file type has no preview here. Download it to open it.',
  );
  await page.goto(app('/documents/not-a-document'));
  await expect(page.getByText('This document was not found')).toBeVisible({ timeout: 60_000 });
});
