import { expect, type Page, test } from '@playwright/test';

// R55, Clients Review 2 (C2-051): the Documents table's row actions. She found Rename, Move,
// Request e-sign and Archive disabled and marked "Not built yet". Each one is opened here from
// the table's row menu and taken to its end. Mock mode as the Owner (mocks/documents.ts: Jamie
// Sample's files), at her 1165 x 747 window. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

async function rowAction(page: Page, file: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${file}` }).click();
  const item = page
    .getByRole('menu', { name: `Actions for ${file}` })
    .getByRole('menuitem', { name: action, exact: true });
  await expect(item).toBeEnabled();
  await expect(item).not.toContainText('Not built yet');
  await item.click();
}

// Clients Review 2 (C2-051): Rename, Move, Request e-sign and Archive work from the table.
test('C2-051: Rename, Move, Request e-sign and Archive each work from the Documents table row menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/documents'));
  await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('filter-client').selectOption({ label: 'Jamie Sample' });
  const names = page.getByTestId('document-name');
  await expect(names).toHaveCount(10);
  const done = page.getByTestId('document-action-done');

  // Rename: the table shows the new name.
  await rowAction(page, 'Tax_Return_2024.pdf', 'Rename');
  const rename = page.getByRole('dialog', { name: 'Rename Document' });
  await rename.getByLabel('File name *').fill('Tax_Return_2024_Final.pdf');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(done).toHaveText('Renamed to Tax_Return_2024_Final.pdf.');
  await expect(names.filter({ hasText: /^Tax_Return_2024_Final\.pdf$/ })).toHaveCount(1);
  await expect(names.filter({ hasText: /^Tax_Return_2024\.pdf$/ })).toHaveCount(0);

  // Move: into one of the client folders.
  await rowAction(page, 'Engagement_Letter_2025.pdf', 'Move');
  const move = page.getByRole('dialog', { name: 'Move Document' });
  await move.getByLabel('Folder').selectOption({ label: 'Tax Returns' });
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(done).toHaveText('Moved to Tax Returns.');

  // Request e-sign: Firm Sign opens with this client and this file.
  const letter = await names
    .filter({ hasText: /^Engagement_Letter_2025\.pdf$/ })
    .getAttribute('href');
  const letterId = letter?.split('/').pop() ?? '';
  await rowAction(page, 'Engagement_Letter_2025.pdf', 'Request e-sign');
  await expect(page).toHaveURL(
    new RegExp(`/firm-sign/new\\?clientId=${JAMIE}&documentId=${letterId}$`),
    { timeout: 60_000 },
  );
  const client = page.getByLabel('Client', { exact: true });
  await expect(client).toHaveValue(JAMIE, { timeout: 60_000 });
  await expect(client.locator('option:checked')).toHaveText('Jamie Sample');

  // Archive: asks first, then archives.
  await page.goBack();
  await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('filter-client').selectOption({ label: 'Jamie Sample' });
  await expect(names).toHaveCount(10);
  await rowAction(page, 'Driver_License.jpg', 'Archive');
  const archive = page.getByRole('dialog', { name: 'Archive Document' });
  await expect(archive).toContainText('It leaves this list but is kept');
  await archive.getByRole('button', { name: 'Archive' }).click();
  await expect(done).toHaveText('Driver_License.jpg archived.');
});
