import { expect, type Page, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const signPage = `http://portal.localhost:${port}/lvp/sign`;

async function drawLine(page: Page) {
  const box = await page.getByTestId('signature-canvas').boundingBox();
  if (!box) throw new Error('No signature canvas');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
}

test('type a signature', async ({ page }) => {
  await page.goto(signPage);
  const state = page.getByTestId('signature-state');
  await expect(state).toHaveText('Add your signature to continue.');
  await page.getByLabel('Your full name').fill('Jordan Sample');
  await expect(page.getByTestId('signature-preview')).toHaveText('Jordan Sample');
  await expect(state).toHaveText('Signature ready.');
  // Another tab holds nothing yet; coming back adopts the typed name again.
  await page.getByRole('tab', { name: 'Draw' }).click();
  await expect(state).toHaveText('Add your signature to continue.');
  await page.getByRole('tab', { name: 'Type' }).click();
  await expect(state).toHaveText('Signature ready.');
  await page.getByLabel('Your full name').fill('');
  await expect(state).toHaveText('Add your signature to continue.');
});

test('draw a signature on a phone, then clear it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(signPage);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await drawLine(page);
  await expect(page.getByTestId('signature-state')).toHaveText('Signature ready.');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('signature-state')).toHaveText('Add your signature to continue.');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('upload a picture of a signature', async ({ page }) => {
  await page.goto(signPage);
  await page.getByRole('tab', { name: 'Upload' }).click();
  // A 1x1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const input = page.getByTestId('signature-upload');
  await input.setInputFiles({ name: 'signature.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('signature-state')).toHaveText('Signature ready.');
  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'),
  });
  await expect(page.getByText('Choose a PNG or JPEG image.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('signature-state')).toHaveText('Add your signature to continue.');
});
