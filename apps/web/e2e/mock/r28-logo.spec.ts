import { expect, test } from '@playwright/test';

// The firm's two logos and sidebar text: Settings > Branding, the setup wizard and the shell, in
// mock mode (an owner). The shell reads the portal info mock, which has the beta firm's logos.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

for (const variant of ['dark', 'light'] as const) {
  test(`an owner uploads, replaces and removes the logo for ${variant} backgrounds, with clear errors`, async ({
    page,
  }) => {
    await page.goto(app('/settings/branding'));
    const field = page.getByTestId(`logo-field-${variant}`);
    await expect(field.getByText('No logo yet')).toBeVisible();
    await expect(field.getByRole('button', { name: 'Remove logo' })).toHaveCount(0);

    const input = page.getByTestId(`logo-input-${variant}`);
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
    await expect(
      field.getByRole('img', { name: new RegExp(`${variant} backgrounds$`) }),
    ).toBeVisible();
    await expect(field.getByRole('button', { name: 'Replace logo' })).toBeVisible();
    // The other slot is untouched, and only the light logo shows in the portal preview.
    const other = variant === 'dark' ? 'light' : 'dark';
    await expect(page.getByTestId(`logo-field-${other}`).getByText('No logo yet')).toBeVisible();
    await expect(page.getByTestId('brand-preview').locator('img')).toHaveCount(
      variant === 'light' ? 1 : 0,
    );

    await field.getByRole('button', { name: 'Remove logo' }).click();
    await expect(field.getByRole('status')).toHaveText('Logo removed.');
    await expect(field.getByText('No logo yet')).toBeVisible();
    await expect(field.getByRole('button', { name: 'Upload logo' })).toBeVisible();
  });
}

test('an owner saves the sidebar slogan and motto', async ({ page }) => {
  await page.goto(app('/settings/branding'));
  await page.getByLabel('Sidebar slogan').fill('Plans That Last.');
  await page.getByLabel('Sidebar motto').fill('PEOPLE | PLANS');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();
  await expect(page.getByLabel('Sidebar slogan')).toHaveValue('Plans That Last.');
});

test('the shell shows the dark logo, the slogan and motto, and the light logo in the footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  const logo = sidebar.locator('img');
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box?.height).toBe(70);
  expect(box?.width).toBeGreaterThan(150);
  await expect(page.getByTestId('firm-slogan')).toContainText('More Than');
  await expect(page.getByTestId('firm-motto')).toHaveText('PEOPLE|PLANS|PROSPERITY');
  // At 900 px high every item fits: the menu does not scroll.
  const menu = page.getByTestId('sidebar-menu');
  expect(await menu.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('img', { name: 'LVP Accounting & Taxes' })).toBeVisible();
  await expect(footer.getByRole('link')).toHaveText(['Support']);
});

test('the setup wizard branding step takes both logos and no longer says "Upload soon"', async ({
  page,
}) => {
  await page.goto(app('/setup'));
  await expect(page.getByText('Upload soon')).toHaveCount(0);
  for (const variant of ['dark', 'light']) {
    await page
      .getByTestId(`logo-input-${variant}`)
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByTestId(`logo-field-${variant}`).getByRole('status')).toHaveText(
      'Logo saved.',
    );
  }
});
