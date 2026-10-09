import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const signPage = `http://portal.localhost:${port}/lvp/sign`;

test('the document draws every page', async ({ page }) => {
  await page.goto(signPage);
  const pages = page.getByTestId('pdf-page');
  await expect(pages).toHaveCount(3);
  // Pages draw as they scroll near the screen.
  for (const n of [1, 2, 3]) {
    await page.locator(`[data-page="${n}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-page="${n}"][data-drawn]`)).toBeVisible();
  }
});

test('without its worker, pdf.js still draws the document', async ({ page }) => {
  // A worker that never loads (a blocked chunk, a strict CSP) must fall back, not hang.
  await page.route(/turbopack-worker/, (route) => route.abort());
  const warnings: string[] = [];
  page.on('console', (m) => warnings.push(m.text()));
  await page.goto(signPage);
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  expect(warnings.some((w) => w.includes('running it on the main thread'))).toBeTruthy();
});

test('the next document opens after the first one has drawn', async ({ page }) => {
  // Closing one document must not take down the pdf.js worker the next one uses.
  await page.goto(signPage);
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  await page.getByRole('button', { name: 'Next document' }).click();
  await expect(page.getByRole('document', { name: 'Sample tax organizer' })).toBeVisible();
  await expect(page.getByTestId('pdf-page')).toHaveCount(2);
  // The button sits below the pages; page 1 draws once it is back near the screen.
  await page.locator('[data-page="1"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  await expect(page.getByTestId('pdf-error')).toHaveCount(0);
  // On to the third and back to the first, on the same worker.
  await page.getByRole('button', { name: 'Next document' }).click();
  await expect(page.getByTestId('pdf-page')).toHaveCount(1);
  await page.getByRole('button', { name: 'Next document' }).click();
  await expect(page.getByTestId('pdf-page')).toHaveCount(3);
  await page.locator('[data-page="1"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
});

test('a scanned page draws its picture', async ({ page }) => {
  // The page is a JPEG 2000 picture: blank unless pdf.js loads its bundled image decoder.
  const warnings: string[] = [];
  page.on('console', (m) => warnings.push(m.text()));
  await page.goto(signPage);
  const next = page.getByRole('button', { name: 'Next document' });
  await next.click();
  await next.click();
  await expect(page.getByRole('document', { name: 'Sample scanned form' })).toBeVisible();
  const scan = page.locator('[data-page="1"]');
  await scan.scrollIntoViewIfNeeded();
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  // The dark block in the middle of the picture (page point 306, 189 from the top).
  const shade = await scan.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    const x = Math.round(canvas.width * (306 / 612));
    const y = Math.round(canvas.height * (189 / 792));
    return ctx?.getImageData(x, y, 1, 1).data[0] ?? 255;
  });
  expect(shade).toBeLessThan(100);
  expect(warnings.filter((w) => /instantiateWasm|JpxError|Jbig2Error|not bundled/.test(w))).toEqual(
    [],
  );
  await expect(page.getByTestId('pdf-no-wasm')).toHaveCount(0);
});

test('without WebAssembly, the signer is told scanned pages may be blank', async ({ page }) => {
  // iOS Lockdown Mode and some locked-down browsers turn WebAssembly off.
  await page.addInitScript(() => {
    // @ts-expect-error removing a built-in on purpose
    delete globalThis.WebAssembly;
  });
  await page.goto(signPage);
  await expect(page.locator('[data-page="1"][data-drawn]')).toBeVisible();
  await expect(page.getByTestId('pdf-no-wasm')).toContainText('Open it in another browser');
});

test("fields sit on the page in their recipient's colour, other signers' faded", async ({
  page,
}) => {
  await page.goto(signPage);
  const first = page.locator('[data-page="1"]');
  const fields = first.getByTestId('esign-field');
  await expect(fields).toHaveCount(5);
  await expect(page.locator('[data-page="2"]').getByTestId('esign-field')).toHaveCount(0);
  // The signer here is Jordan: their fields stay bright, Riley's fade.
  const mine = first.getByLabel('Signature (required), Jordan Sample');
  await expect(mine).not.toHaveClass(/opacity-40/);
  const riley = first.getByLabel('Signature (required), Riley Sample');
  await expect(riley).toHaveClass(/opacity-40/);
  // A custom label shows on the box, not only to screen readers.
  await expect(first.getByLabel('Spouse name, Riley Sample')).toContainText('Spouse name');
  // The sender's prefilled value is shown, readable, in the neutral colour.
  const fee = first.getByLabel('Text, Sender: Fee: $450');
  await expect(fee).toContainText('Fee: $450');
  await expect(fee).not.toHaveClass(/opacity-40/);
  // Placed by fractions of the page: Jordan's signature starts 18% in and 78% down.
  const pageBox = (await first.boundingBox())!;
  const fieldBox = (await mine.boundingBox())!;
  expect(Math.abs(fieldBox.x - pageBox.x - pageBox.width * 0.18)).toBeLessThan(2);
  expect(Math.abs(fieldBox.y - pageBox.y - pageBox.height * 0.78)).toBeLessThan(2);
  // Jordan, Riley and the sender: three colours.
  const colour = (l: typeof mine) => l.evaluate((e) => getComputedStyle(e).borderTopColor);
  expect(new Set([await colour(mine), await colour(riley), await colour(fee)]).size).toBe(3);
});
