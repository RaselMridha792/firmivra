import { expect, test } from '@playwright/test';

// B32 (Client Portal Review One, decision 5 option B): Share with Client. A firm note stays
// internal; its text goes to the client as a portal message only after the member sees the exact
// text and confirms. Bookkeeping's Add Note and Business Advisory's notes offer it. Mock mode as
// the Owner (the notes mock reaches the Bookkeeping and Advisory mocks' clients, as the API does).
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test.describe.configure({ timeout: 240_000 });

test('Bookkeeping Add Note: internal by default; Share with client previews the exact text and sends nothing until confirmed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/bookkeeping/clients/${GREEN}`));
  const notes = page.getByTestId('shared-notes');
  const add = async (text: string) => {
    await notes.getByRole('button', { name: 'Add Note' }).click({ timeout: 60_000 });
    const dialog = page.getByRole('dialog', { name: 'Add Note' });
    await expect(dialog.getByLabel('Internal (staff only)')).toBeChecked();
    await dialog.getByLabel('Note', { exact: true }).fill(text);
    await dialog.getByLabel('Share with client').check();
    await expect(dialog.getByTestId('note-visibility')).toContainText('only when you confirm');
    await dialog.getByRole('button', { name: 'Save and Preview' }).click();
    await expect(dialog).toBeHidden();
  };
  const preview = page.getByRole('dialog', { name: 'Share with Client' });

  // Cancel at the preview: the note is saved, internal, and nothing goes to the client.
  await add('Fake: March statement received.');
  await expect(preview.getByTestId('share-text')).toHaveText('Fake: March statement received.');
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByTestId('note-saved')).toHaveText(
    'Note added. It is internal: the client never sees it.',
  );

  // Confirmed: the exact text, under the message's subject, goes as a portal message.
  const text = 'Fake: please send the April statement.\nThe bank feed stopped on Apr 3.';
  await add(text);
  await expect(preview).toContainText('A note from your firm');
  await expect(preview.getByTestId('share-text')).toHaveText(text);
  await expect(preview).toContainText('The note itself stays internal.');
  await preview.getByRole('button', { name: 'Share with Client' }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByTestId('note-saved')).toContainText(
    'sent to the client as a portal message. The note stays internal.',
  );
});

test('Business Advisory notes: each note has Share with Client, with a preview; the note stays internal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/business-advisory/clients/${MARCUS}/notes`));
  await expect(page.getByTestId('note-audience')).toContainText('Internal · staff only', {
    timeout: 60_000,
  });
  const text = 'Fake: SBA timeline agreed.\nNext review in June.';
  await page.getByTestId('tab-note-new').getByLabel('Note').fill(text);
  await page.getByRole('button', { name: 'Save Note' }).click();
  const list = page.getByTestId('note-list');
  await expect(list).toContainText('Fake: SBA timeline agreed.');
  // Nothing is shared by saving: the note says it is internal.
  await expect(list).toContainText('Internal · staff only');

  // Cancel shares nothing.
  await list.getByRole('button', { name: 'Share with Client' }).click();
  const preview = page.getByRole('dialog', { name: 'Share with Client' });
  await expect(preview.getByTestId('share-text')).toHaveText(text);
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await expect(preview).toBeHidden();

  await list.getByRole('button', { name: 'Share with Client' }).click();
  await expect(preview).toContainText('A note from your firm');
  await preview.getByRole('button', { name: 'Share with Client' }).click();
  await expect(preview).toBeHidden();
  await expect(
    page.getByText('Shared with the client as a portal message. The note stays internal.'),
  ).toBeVisible();
  await expect(list).toContainText('Internal · staff only');
});
