import { expect, test, type Page } from '@playwright/test';

// R56: Document Settings (Documents design, Frame 6) in mock mode: `api.documentLibrary`'s
// folders, document types and settings. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function open(page: Page, path = '/documents/settings') {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(path));
  await expect(page.getByTestId('document-settings')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tree-folder').first()).toBeVisible();
}

test('Folders & Categories: the tree, a folder’s details, and a new subfolder', async ({
  page,
}) => {
  await open(page);
  const tree = page.getByTestId('folder-tree');
  await expect(tree).toContainText('Client Documents');
  await expect(tree.getByLabel('Firm only')).toBeVisible();
  // The first folder inside the first top folder is open to start.
  const editor = page.getByTestId('folder-editor');
  await expect(editor.getByRole('heading', { name: 'Tax Returns' })).toBeVisible();
  await expect(editor.getByLabel('Folder Name *')).toHaveValue('Tax Returns');
  await expect(editor.getByLabel('Default Access')).toHaveValue('VIEW_UPLOAD');
  await expect(page.getByTestId('folder-info')).toContainText('12');

  // "Marketing & Misc" and "Marketing", each under its top folder.
  await page.getByRole('searchbox', { name: 'Search folders' }).fill('market');
  await expect(page.getByTestId('tree-folder')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Search folders' }).fill('');

  await editor.getByLabel('Folder Name *').fill('Personal Tax');
  // The swatch is the radio's label (the radio itself is visually hidden).
  await editor
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: 'Green' }) })
    .click();
  await expect(editor.getByRole('radio', { name: 'Green' })).toBeChecked();
  await editor.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Personal Tax was saved.')).toBeVisible();
  await expect(tree).toContainText('Personal Tax');

  await tree.getByRole('button', { name: 'Actions for Personal Tax' }).click();
  await page.getByRole('menuitem', { name: 'Add Subfolder' }).click();
  await expect(
    editor.getByRole('heading', { name: 'New Subfolder in Personal Tax' }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Create Folder' }).click();
  await expect(editor.getByText('Enter the folder’s name.')).toBeVisible();
  await editor.getByLabel('Folder Name *').fill('Fake 2025 Returns');
  await editor.getByRole('button', { name: 'Create Folder' }).click();
  await expect(editor.getByRole('heading', { name: 'Fake 2025 Returns' })).toBeVisible();

  // A folder with documents is not deleted.
  await page.getByTestId('tree-folder').filter({ hasText: 'Personal Tax' }).click();
  await editor.getByRole('button', { name: 'Delete Folder' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Folder' }).click();
  await expect(page.getByText('This folder still holds documents or subfolders.')).toBeVisible();
});

test('Reorder Folders and the other tabs save their settings', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Reorder Folders' }).click();
  const list = page.getByTestId('reorder-list');
  await expect(list.getByRole('listitem').first()).toContainText('Tax Returns');
  await page.getByRole('button', { name: 'Move Tax Returns down' }).click();
  await page.getByRole('button', { name: 'Save Order' }).click();
  await expect(page.getByText('The new order was saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Access & Permissions' }).click();
  await page.getByLabel('Default client access for Payroll').selectOption('VIEW');
  await expect(page.getByText('Payroll was saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'Expiration & Reminders' }).click();
  const save = page.getByRole('button', { name: 'Save Changes' });
  await expect(save).toBeDisabled();
  await page.getByLabel('A request expires after it is sent').selectOption('30');
  await save.click();
  await expect(page.getByText('Document settings were saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'File Settings' }).click();
  await page.getByRole('checkbox', { name: 'Word (.docx)' }).uncheck();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Document settings were saved.')).toBeVisible();

  await page.getByRole('tab', { name: 'General Settings' }).click();
  await page.getByLabel('New document type').fill('Fake Engagement Letters');
  await page.getByRole('button', { name: 'Add Type' }).click();
  await expect(
    page.getByTestId('document-type').filter({ hasText: 'Fake Engagement Letters' }),
  ).toBeVisible();
  await page
    .getByTestId('document-type')
    .filter({ hasText: 'Old Receipts' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByText('Old Receipts was restored.')).toBeVisible();
});

test('the Documents page’s Add Folder opens Document Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/documents'));
  await expect(page.getByTestId('add-folder')).toHaveAttribute('href', '/documents/settings', {
    timeout: 60_000,
  });
});
