// Octavia's Bookkeeping Review 2, new approved row (G9): Documents' Archived and Trash say in
// plain words why they are empty. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Documents messages (G9): Archived and Trash say in plain words why they are empty', async ({
  page,
}) => {
  await page.goto(`${app}/documents`);
  const archived = page.getByTestId('folder-archived');
  await expect(archived).toBeDisabled();
  await expect(archived).toHaveAccessibleDescription(
    'Archived documents are not available yet. Every document stays in its client’s list.',
  );
  const trash = page.getByTestId('folder-trash');
  await expect(trash).toHaveText(/Trash0/);
  await expect(trash).toHaveAccessibleDescription(
    'Trash is empty: documents cannot be deleted here yet, so nothing is ever lost.',
  );
});
