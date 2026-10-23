import { expect, type Page, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item 8 (CHANGE-LIST L4): Send Email formats the message
// (font, size, bold and italic), takes an image that can be resized and placed, and keeps the
// member's saved signature with the firm's logo under the message, for one lead and for selected
// leads, in mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only. Delivered
// formatting is checked against the real API and Mailpit (PR evidence), not here.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYPj/n4EIwDiqEAAqEAEA9xMPUgAAAABJRU5ErkJggg==',
  'base64',
);

const openFromRow = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page
    .getByRole('table', { name: 'Leads' })
    .getByRole('button', { name: 'Send email to bruno.sandoval@example.test' })
    .click();
  return page.getByTestId('lead-message-email');
};
const message = (page: Page) =>
  page.getByTestId('lead-message-email').getByRole('textbox', { name: 'Message' });

test('formats the text: font, size, bold and italic, then sends', async ({ page }) => {
  const dialog = await openFromRow(page);
  await expect(dialog.getByTestId('message-recipients')).toContainText(
    'bruno.sandoval@example.test',
  );
  await dialog.getByLabel('Subject').fill('Welcome');
  const box = message(page);
  await box.click();
  await page.keyboard.type('Thanks for getting in touch.');
  await page.keyboard.press('Control+A');
  await dialog.getByLabel('Font', { exact: true }).selectOption({ label: 'Georgia' });
  await dialog.getByLabel('Size', { exact: true }).selectOption({ label: '20 px' });
  await dialog.getByRole('button', { name: 'Bold' }).click();
  await dialog.getByRole('button', { name: 'Italic' }).click();
  const html = await box.innerHTML();
  expect(html).toContain('font-family: Georgia, serif');
  expect(html).toContain('font-size: 20px');
  expect(html).toMatch(/<b>|font-weight: bold/);
  expect(html).toMatch(/<i>|font-style: italic/);
  // No link button: links are not kept in a lead email.
  await expect(dialog.getByRole('button', { name: 'Insert link' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByTestId('message-result')).toHaveText('Email sent to 1 lead.');
});

test('an image is uploaded, resized and placed in the centre', async ({ page }) => {
  const dialog = await openFromRow(page);
  await message(page).click();
  await page.keyboard.type('See the chart below.');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Insert image' }).click();
  await (await chooser).setFiles({ name: 'chart.png', mimeType: 'image/png', buffer: PNG });
  const image = message(page).locator('img');
  await expect(image).toHaveCount(1);
  await image.click();
  const controls = dialog.getByRole('group', { name: 'Selected image' });
  await expect(controls).toBeVisible();
  const width = controls.getByLabel('Image width');
  await width.focus();
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
  await expect(image).toHaveAttribute('style', /width: \d+px/);
  await controls.getByRole('button', { name: 'Place image in the centre' }).click();
  // The image moves to its own line; the text stays where it was.
  const html = await message(page).innerHTML();
  expect(html).toMatch(/<p style="text-align: center;"><img [^>]*><\/p>/);
  expect(html).toContain('See the chart below.');
  expect(html).not.toMatch(/text-align: center;">See/);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByTestId('message-result')).toHaveText('Email sent to 1 lead.');
});

test('a wrong image type is refused in words', async ({ page }) => {
  const dialog = await openFromRow(page);
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Insert image' }).click();
  await (
    await chooser
  ).setFiles({ name: 'chart.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(dialog).toContainText('Use a PNG, JPG or GIF image.');
  await expect(message(page).locator('img')).toHaveCount(0);
});

test('the signature is saved with the firm logo and goes under the message', async ({ page }) => {
  const dialog = await openFromRow(page);
  const signature = dialog.getByTestId('email-signature');
  await expect(signature).toContainText('You have no saved signature yet.');
  await signature.getByRole('button', { name: 'Create signature' }).click();
  await signature.getByRole('textbox', { name: 'Your signature' }).click();
  await page.keyboard.type('Morgan Avery, LVP Accounting & Taxes');
  await signature.getByRole('button', { name: 'Insert firm logo' }).click();
  await signature.getByRole('button', { name: 'Save signature' }).click();
  await expect(signature).toContainText('Your saved signature is added under the message.');
  // Nothing written yet: the saved signature is already under the message.
  await expect(message(page)).toContainText('Morgan Avery, LVP Accounting & Taxes');
  await expect(message(page).locator('img')).toHaveCount(1);
  // Removed from this email, then put back.
  await message(page).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(message(page).locator('img')).toHaveCount(0);
  await signature.getByRole('button', { name: 'Insert my signature' }).click();
  await expect(message(page)).toContainText('Morgan Avery, LVP Accounting & Taxes');
  await expect(message(page).locator('img')).toHaveCount(1);

  // A new email starts with the saved signature under a blank line.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('table', { name: 'Leads' })
    .getByRole('button', { name: 'Send email to bruno.sandoval@example.test' })
    .click();
  await expect(message(page)).toContainText('Morgan Avery, LVP Accounting & Taxes');
});

test('selected leads: every address listed, a message is required, then how many went', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const table = page.getByRole('table', { name: 'Leads' });
  for (const name of ['Bruno Sandoval', 'Selma Shields'])
    await table
      .getByRole('row', { name: new RegExp(name) })
      .getByRole('checkbox')
      .check();
  await page.getByRole('button', { name: 'Send Email' }).first().click();
  const dialog = page.getByTestId('lead-message-email');
  await expect(dialog.getByTestId('message-recipients').getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog).toContainText('Write a message');
  await message(page).click();
  await page.keyboard.type('Office closed Friday.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(dialog.getByTestId('message-result')).toHaveText('Email sent to 2 leads.');
});

test('no sideways scroll at 375 px with the composer open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${url}/0199c0c0-0a00-7000-8000-000000000003/notes`);
  await page
    .getByRole('group', { name: 'Lead actions' })
    .getByRole('button', { name: 'Email' })
    .click();
  await expect(message(page)).toBeVisible();
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
});
