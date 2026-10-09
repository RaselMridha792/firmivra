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

/** A synthetic JPEG drawn in the browser: grey-white paper with a dark stroke, or pure noise. */
async function photo(page: Page, kind: 'signature' | 'noise') {
  const base64 = await page.evaluate((k) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = k === 'noise' ? Math.random() * 255 : 225 + Math.random() * 30;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (k === 'signature') {
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(300, 600);
      ctx.bezierCurveTo(600, 100, 900, 800, 1300, 350);
      ctx.stroke();
    }
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1]!;
  }, kind);
  return { name: `${kind}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}

test('a photo of a signature becomes a small ink-only image', async ({ page }) => {
  await page.goto(signPage);
  await page.getByRole('tab', { name: 'Upload' }).click();
  const input = page.getByTestId('signature-upload');
  await input.setInputFiles(await photo(page, 'signature'));
  await expect(page.getByTestId('signature-state')).toHaveText('Signature ready.');
  const src = await page.locator('[data-testid="signature-pad-signature"] img').getAttribute('src');
  expect(src?.startsWith('data:image/png')).toBeTruthy();
  expect(src!.length).toBeLessThan(90_000);
  // A picture that is all detail cannot be made small: refused, with a way forward.
  await input.setInputFiles(await photo(page, 'noise'));
  await expect(
    page.getByText('This picture is too detailed. Try a closer photo on plain white paper.'),
  ).toBeVisible();
  await expect(page.getByTestId('signature-state')).toHaveText('Add your signature to continue.');
});
