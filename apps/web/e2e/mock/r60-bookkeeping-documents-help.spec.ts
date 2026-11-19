// Octavia's Bookkeeping Review 2, new approved row (plain-language Documents messages, G9):
// Archived and Trash say truly what they are and what users can do, and they work: the chosen
// client's archived or trashed files, their counts, and the way back. Mock mode, as an Owner.
// Synthetic data only.
import { expect, type Page, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

const ARCHIVED_HELP =
  'Documents archived from their menu or page. They leave the lists but are kept; Restore brings one back.';
const TRASH_HELP =
  'Documents moved to Trash. They are kept and never deleted for good from here; Restore from Trash brings one back.';

async function rowAction(page: Page, file: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${file}` }).click();
  await page
    .getByRole('menu', { name: `Actions for ${file}` })
    .getByRole('menuitem', { name: action, exact: true })
    .click();
}

test('Documents messages (G9): Archived and Trash say what they hold, list the client’s files, and restore them', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1165, height: 900 });
  // Without a client, they wait for one, and say so.
  await page.goto(`${app}/documents`);
  const archived = page.getByTestId('folder-archived');
  const trash = page.getByTestId('folder-trash');
  await expect(archived).toBeDisabled({ timeout: 60_000 });
  await expect(archived).toHaveAccessibleDescription(
    'Select a client to see their archived and trashed documents.',
  );

  // A client's documents (as a Bookkeeping workspace opens them): nothing archived or trashed yet.
  await page.goto(`${app}/documents?clientId=${JAMIE}`);
  const names = page.getByTestId('document-name');
  await expect(names).toHaveCount(10, { timeout: 60_000 });
  await expect(archived).toHaveText(/Archived0/);
  await expect(archived).toHaveAccessibleDescription(ARCHIVED_HELP);
  await expect(trash).toHaveText(/Trash0/);
  await expect(trash).toHaveAccessibleDescription(TRASH_HELP);

  // Archive one: it leaves the list and shows under Archived, with the help in plain words.
  await rowAction(page, 'Driver_License.jpg', 'Archive');
  await page
    .getByRole('dialog', { name: 'Archive Document' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(names.filter({ hasText: 'Driver_License.jpg' })).toHaveCount(0);
  await expect(archived).toHaveText(/Archived1/);
  await archived.click();
  const kept = page.getByTestId('kept-archived');
  await expect(kept.getByTestId('kept-help')).toHaveText(ARCHIVED_HELP);
  await expect(kept).toContainText('Driver_License.jpg');
  await expect(kept).toContainText(/Archived [A-Z][a-z]{2} \d{1,2}, \d{4}/);

  // Restore brings it back.
  await kept.getByRole('button', { name: 'Restore: Driver_License.jpg' }).click();
  await expect(kept.getByRole('status')).toHaveText(
    'Driver_License.jpg is back in Jamie Sample’s documents.',
  );
  await expect(kept).toContainText('Jamie Sample has no archived documents.');
  await expect(archived).toHaveText(/Archived0/);
  await kept.getByRole('button', { name: 'Back to documents' }).click();
  await expect(names.filter({ hasText: 'Driver_License.jpg' })).toHaveCount(1);

  // Trash: its own help, and nothing of hers in it.
  await trash.click();
  const bin = page.getByTestId('kept-trash');
  await expect(bin.getByTestId('kept-help')).toHaveText(TRASH_HELP);
  await expect(bin).toContainText('Nothing of Jamie Sample’s is in the Trash.');
});
