import { expect, test } from '@playwright/test';

// The firm's logo in Settings > Branding and the setup wizard, in mock mode (an owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('an owner uploads, replaces and removes the logo, with clear errors', async ({ page }) => {
  await page.goto(app('/settings/branding'));
  const field = page.getByTestId('logo-field');
  await expect(field.getByText('Firmivra logo', { exact: true })).toBeVisible();
  await expect(field.getByRole('button', { name: 'Remove logo' })).toHaveCount(0);

  const input = page.getByTestId('logo-input');
  await input.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(field.getByRole('alert')).toHaveText('The logo must be a PNG, JPG or WebP image.');
  const big = Buffer.alloc(2 * 1024 * 1024 + 1);
  await input.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big });
  await expect(field.getByRole('alert')).toHaveText('The logo must be 2 MB or smaller.');

  await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(field.getByRole('status')).toHaveText('Logo saved.');
  await expect(field.getByRole('alert')).toHaveCount(0);
  await expect(field.getByRole('img', { name: /logo$/ })).toBeVisible();
  await expect(page.getByTestId('brand-preview').locator('img')).toBeVisible();
  await expect(field.getByRole('button', { name: 'Replace logo' })).toBeVisible();

  await field.getByRole('button', { name: 'Remove logo' }).click();
  await expect(field.getByRole('status')).toHaveText('Logo removed.');
  await expect(field.getByText('Firmivra logo', { exact: true })).toBeVisible();
  await expect(field.getByRole('button', { name: 'Upload logo' })).toBeVisible();
});

test('the setup wizard branding step takes a logo and no longer says "Upload soon"', async ({
  page,
}) => {
  await page.goto(app('/setup'));
  await expect(page.getByText('Upload soon')).toHaveCount(0);
  await page
    .getByTestId('logo-input')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('logo-field').getByRole('status')).toHaveText('Logo saved.');
});
