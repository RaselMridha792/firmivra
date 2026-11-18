import { expect, test, type Page } from '@playwright/test';

// R55, Communications and Messaging Review Two, C21 (playwright.mock.config.ts, as an Owner; the
// mock answers as the API): My Signature, the member's reusable closing, takes an image through
// the firm's email-image upload (the one the Leads email uses, the only images the API keeps in
// a signature). An email gets the image from Insert Closing; an SMS gets the words only. A wrong
// type or a file over 2 MB is refused in words. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYPj/n4EIwDiqEAAqEAEA9xMPUgAAAABJRU5ErkJggg==',
  'base64',
);

/** New Communication opens the composer itself (nothing saved until its first save). */
const start = async (page: Page, channel: 'EMAIL' | 'SMS') => {
  await page.goto(`${base}/new?channel=${channel}`);
  await expect(page.getByTestId('composer')).toBeVisible();
};
const closing = async (page: Page, item: string) => {
  await page.getByTestId('closing-menu').getByRole('button', { name: 'Insert Closing' }).click();
  const entry = page.getByRole('menuitem', { name: new RegExp(`^${item}`) });
  await expect(entry).not.toContainText('Loading');
  await entry.click();
};
const chooseImage = async (
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('my-signature').getByRole('button', { name: 'Insert image' }).click();
  await (await chooser).setFiles(file);
};
/** Edit My Signature: some words, then an uploaded image, then Save. */
const saveWithImage = async (page: Page) => {
  await closing(page, 'Edit My Signature');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(
    'Your own closing: text, formatting and images. A text message gets the words only.',
  );
  const editor = page.getByTestId('my-signature').getByRole('textbox', { name: 'Signature' });
  await editor.click();
  await page.keyboard.type('Kind regards, Mock User');
  await chooseImage(page, { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(editor.locator('img')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Save Signature' }).click();
  await expect(
    page.getByText('Your signature is saved. Insert it from Insert Closing.').filter({
      visible: true,
    }),
  ).toBeVisible();
};

test('My Signature takes an uploaded image, and an email gets it from Insert Closing (C21)', async ({
  page,
}) => {
  await start(page, 'EMAIL');
  await saveWithImage(page);
  // Saved: opening it again shows the image the API kept.
  await closing(page, 'Edit My Signature');
  const editor = page.getByTestId('my-signature').getByRole('textbox', { name: 'Signature' });
  await expect(editor.locator('img')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  const content = page.getByRole('textbox', { name: 'Message' });
  await content.click();
  await page.keyboard.type('Thanks for your time.');
  await closing(page, 'My signature');
  await expect(content).toContainText('Kind regards, Mock User');
  await expect(content.locator('img')).toHaveCount(1);
});

test('an SMS takes the signature with an image as words only (C21)', async ({ page }) => {
  await start(page, 'SMS');
  await saveWithImage(page);
  const message = page
    .getByTestId('composer')
    .getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Your documents are ready.');
  await closing(page, 'My signature');
  await expect(message).toHaveValue('Your documents are ready.\n\nKind regards, Mock User');
});

test('a wrong image type or one over 2 MB is refused in words, and nothing is added (C21)', async ({
  page,
}) => {
  await start(page, 'EMAIL');
  await closing(page, 'Edit My Signature');
  const box = page.getByTestId('my-signature');
  const editor = box.getByRole('textbox', { name: 'Signature' });
  await chooseImage(page, {
    name: 'photo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(box).toContainText('Use a PNG, JPG or GIF image.');
  await chooseImage(page, {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]),
  });
  await expect(box).toContainText('That image is too large: at most 2 MB.');
  await expect(editor.locator('img')).toHaveCount(0);
});
