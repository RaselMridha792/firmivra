import { expect, test } from '@playwright/test';

// R60, MSG-F12 (Octavia's Messages review of Oct 27): the firm's reply carries the client's own
// documents the client can see, or a file uploaded into them; internal and blocked files never go,
// and Messages Settings decide the types and the size. Mock mode as the Owner, on Jamie Sample's
// conversation (Jamie's documents are the documents mock's).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const openJamie = async (page: import('@playwright/test').Page) => {
  await page.goto(app('/messages'));
  await page.getByLabel('Search messages').fill('jamie');
  await expect(page.getByTestId('thread-row').first()).toContainText('Jamie Sample');
  await page.getByTestId('thread-row').first().click();
  await expect(page.getByTestId('conversation')).toContainText('Jamie Sample');
};

test('Attach offers the client’s documents they can see; the reply carries them', async ({
  page,
}) => {
  await openJamie(page);
  await page.getByRole('button', { name: 'Attach files' }).click();
  const dialog = page.getByTestId('attach-dialog');
  const docs = dialog.getByRole('region', { name: 'Client documents' });
  await expect(docs.getByText('Engagement_Letter_2025.pdf')).toBeVisible();
  // Internal and blocked files never show; a type Messages Settings don't allow can't be picked.
  await expect(docs.getByText('Preparer_Worksheet.pdf')).toHaveCount(0);
  await expect(docs.getByText('Scanned_Receipt.pdf')).toHaveCount(0);
  await expect(docs.getByRole('checkbox', { name: /Rental_Income_2025\.xlsx/ })).toBeDisabled();
  await expect(docs.getByText('Type not allowed')).toBeVisible();

  await docs.getByRole('checkbox', { name: /Engagement_Letter_2025\.pdf/ }).check();
  await docs.getByRole('checkbox', { name: /W-2_2025\.pdf/ }).check();
  await page.getByRole('button', { name: 'Attach (2)' }).click();
  const chosen = page.getByTestId('chosen-files');
  await expect(chosen).toContainText('Engagement_Letter_2025.pdf');
  await chosen.getByRole('button', { name: 'Remove W-2_2025.pdf' }).click();
  await expect(chosen).not.toContainText('W-2_2025.pdf');

  await page.getByLabel('Type a message').fill('Your signed engagement letter is attached.');
  await page.getByRole('button', { name: 'Send message' }).click();
  const sent = page.getByTestId('conversation').getByRole('listitem').filter({
    hasText: 'Your signed engagement letter is attached.',
  });
  await expect(sent.getByTestId('message-files')).toContainText('Engagement_Letter_2025.pdf');
  await expect(sent.getByRole('button', { name: /Engagement_Letter_2025\.pdf/ })).toBeEnabled();
  await expect(page.getByTestId('chosen-files')).toHaveCount(0);
});

test('Upload a file saves it in the client’s documents, shared, and attaches it', async ({
  page,
}) => {
  await openJamie(page);
  await page.getByRole('button', { name: 'Attach files' }).click();
  const dialog = page.getByTestId('attach-dialog');
  // Jamie has several open services and the thread names none: choose where the file goes.
  const under = dialog.getByLabel('File it under');
  await expect(under).toBeVisible();
  await under.selectOption({ index: 1 });
  await dialog.getByLabel('Upload a file').setInputFiles({
    name: 'Signed_Organizer.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(page.getByRole('button', { name: 'Attach (1)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Attach (1)' }).click();
  await expect(page.getByTestId('chosen-files')).toContainText('Signed_Organizer.pdf');
  await page.getByLabel('Type a message').fill('Here is the organizer we discussed.');
  await page.getByRole('button', { name: 'Send message' }).click();
  const sent = page.getByTestId('conversation').getByRole('listitem').filter({
    hasText: 'Here is the organizer we discussed.',
  });
  // Still being checked: it opens once the security check passes.
  await expect(sent.getByTestId('message-files')).toContainText('Signed_Organizer.pdf');
});

test('No sideways scroll at 375 px with Attach open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openJamie(page);
  await page.getByRole('button', { name: 'Attach files' }).click();
  await expect(page.getByTestId('attach-dialog')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
