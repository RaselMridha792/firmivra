import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F07 (playwright.mock.config.ts, as an Owner; the mock
// answers as the API): a rich template's content takes an image (uploaded and placed), alignment
// and a call-to-action button, from the keyboard too; it is saved and kept, and Preview shows it
// as an email does. SMS stays plain text.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
// A 1 x 1 PNG (synthetic).
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('an image, centred text and a button are kept, and Preview shows them (TP-F07)', async ({
  page,
}) => {
  await page.goto(`${base}/new?kind=EMAIL`);
  await page.getByLabel('Template Name *').fill('Upload reminder');
  await page.getByLabel('Subject Line').fill('Please upload your documents');
  const content = page.getByRole('textbox', { name: 'Email Content' });
  const tools = page.getByRole('toolbar', { name: 'Email Content formatting' });
  await content.click();
  await page.keyboard.type('Thanks for choosing us.');

  // Centre the paragraph, from the keyboard.
  await tools.getByRole('button', { name: 'Align centre' }).focus();
  await page.keyboard.press('Enter');
  await expect(content.locator('p[style*="text-align: center"]')).toHaveText(
    'Thanks for choosing us.',
  );

  // A button: its words and an https address; http is refused in words.
  await content.click();
  await page.keyboard.press('End');
  await tools.getByRole('button', { name: 'Insert button' }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert Button' });
  await dialog.getByLabel('Button text').fill('Upload Documents');
  await dialog.getByLabel('Link address').fill('http://example.test');
  await dialog.getByRole('button', { name: 'Insert Button' }).click();
  await expect(dialog.getByText('Enter an address that starts with https://')).toBeVisible();
  await dialog.getByLabel('Link address').fill('https://portal.example.test/lvp/upload');
  await dialog.getByRole('button', { name: 'Insert Button' }).click();
  await expect(content.locator('a.fv-button')).toHaveText('Upload Documents');
  await expect(content.locator('a.fv-button')).toHaveAttribute(
    'href',
    'https://portal.example.test/lvp/upload',
  );

  // An image, uploaded to the firm's email images and placed in the text.
  await content.click();
  const chooser = page.waitForEvent('filechooser');
  await tools.getByRole('button', { name: 'Insert image' }).click();
  await (await chooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(content.locator('img')).toHaveCount(1);

  // Saved, it keeps all three.
  await page.getByTestId('save-template').click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}\/edit$/);
  await expect(content.locator('a.fv-button')).toHaveText('Upload Documents');
  await expect(content.locator('img')).toHaveCount(1);
  await expect(content.locator('p[style*="text-align: center"]')).toHaveCount(1);

  // Preview shows them as an email does.
  await page.getByRole('button', { name: 'Preview Template' }).click();
  const frame = page.frameLocator('[data-testid="preview-body"]');
  await expect(frame.getByRole('link', { name: 'Upload Documents' })).toBeVisible();
  await expect(frame.locator('img')).toHaveCount(1);
});

test('an SMS stays plain text: no formatting tools (TP-F07)', async ({ page }) => {
  await page.goto(`${base}/new?kind=SMS`);
  await expect(page.getByLabel('Message *')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insert button' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Align centre' })).toHaveCount(0);
});

test('the SMS counter counts parts as carriers do: GSM-7, extension characters and Unicode (R02)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/new?kind=SMS`);
  const body = page.getByLabel('Message *');
  const count = page.getByTestId('sms-count');
  const parts = async (text: string, expected: string) => {
    await body.fill(text);
    await expect(count).toContainText(expected);
  };
  await expect(body).toBeVisible({ timeout: 60_000 });
  // Standard characters: 160 one text, 161 two, 306 two, 307 three.
  await parts('A'.repeat(160), '160 characters · 1 text part (standard characters');
  await parts('A'.repeat(161), '161 characters · 2 text parts');
  await parts('A'.repeat(306), '306 characters · 2 text parts');
  await parts('A'.repeat(307), '307 characters · 3 text parts');
  // An extension character is two: 80 carets fit one text, 81 do not.
  await parts('^'.repeat(80), '80 characters · 1 text part');
  await parts('^'.repeat(81), '81 characters · 2 text parts');
  // Unicode: 70 one text, 71 two; an emoji counts twice, so 36 take two parts.
  await parts('漢'.repeat(70), '70 characters · 1 text part (special characters');
  await parts('漢'.repeat(71), '71 characters · 2 text parts');
  await parts(String.fromCodePoint(0x1f600).repeat(35), '35 characters · 1 text part');
  await parts(String.fromCodePoint(0x1f600).repeat(36), '36 characters · 2 text parts');
});
