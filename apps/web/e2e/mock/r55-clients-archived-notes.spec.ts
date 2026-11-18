import { expect, test } from '@playwright/test';

// Clients Review 2 G4 (test gap): an archived client's internal notes are read-only on the web, as
// the API's 409 CLIENT_ARCHIVED says. The notes stay listed; there is no New note box or Save Note,
// and a line says why. An active client's Notes still take a new note. Mock mode as the Owner:
// mock client 4 (Pat Archived) is archived, mock client 1 (Jamie Sample) is not. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/clients`;
const archived = '0199b6a1-0000-7000-8000-000000000004';
const active = '0199b6a1-0000-7000-8000-000000000001';

test('G4: an archived client’s notes are read-only; an active client’s take a new note', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/${archived}/notes`);
  const notes = page.getByTestId('client-notes');
  await expect(notes.getByTestId('notes-read-only')).toHaveText(
    'This client is archived, so its notes are read-only until it is restored.',
    { timeout: 60_000 },
  );
  await expect(notes.getByLabel('New note')).toHaveCount(0);
  await expect(notes.getByRole('button', { name: 'Save Note' })).toHaveCount(0);

  await page.goto(`${base}/${active}/notes`);
  await expect(notes.getByLabel('New note')).toBeVisible({ timeout: 60_000 });
  await expect(notes.getByRole('button', { name: 'Save Note' })).toBeVisible();
  await expect(notes.getByTestId('notes-read-only')).toHaveCount(0);
});
