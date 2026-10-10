import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('pages: reorder, turn and leave one out', async ({ page }) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Synthetic page order');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Upload files').setInputFiles({
    name: 'Synthetic pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  // The mock's PDFs have two pages; they show once the file's check is done.
  const thumbs = page.getByTestId('page-plan').getByTestId('page-thumb');
  await expect(thumbs).toHaveCount(2, { timeout: 15_000 });
  await expect(thumbs.first()).toHaveAccessibleName('Page 1: Synthetic pages.pdf, page 1');

  await page.getByRole('button', { name: 'Move Page 2 earlier' }).click();
  await expect(thumbs.first()).toHaveAccessibleName('Page 1: Synthetic pages.pdf, page 2');
  await expect(page.getByRole('button', { name: 'Move Page 1 earlier' })).toBeDisabled();

  await page.getByRole('button', { name: 'Turn Page 1 clockwise' }).click();
  await expect(thumbs.first()).toHaveAttribute('data-rotation', '90');

  await page.getByRole('button', { name: 'Remove Page 2' }).click();
  await expect(thumbs).toHaveCount(1);
  await expect(page.getByText('Pages (1)')).toBeVisible();
  // The packet keeps at least one page.
  await expect(page.getByRole('button', { name: 'Remove Page 1' })).toBeDisabled();
});
