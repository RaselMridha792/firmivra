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
  expect((await sidebar.boundingBox())?.width).toBe(240);
  const logo = sidebar.locator('img');
  await expect(logo).toBeVisible();
  // The logo fills the inner width (240 px minus 20 px each side), left aligned, up to 100 px high.
  const box = await logo.boundingBox();
  expect(box?.x).toBe(20);
  expect(box?.width).toBe(200);
  expect(box?.height).toBeLessThanOrEqual(100);
  const slogan = page.getByTestId('firm-slogan');
  await expect(slogan).toContainText('More Than');
  await expect(page.getByTestId('firm-motto')).toHaveText('PEOPLE|PLANS|PROSPERITY');

  // The design's rows: a 37 px pill every 33 px, whatever the window height.
  const links = sidebar.getByTestId('sidebar-menu').getByRole('link');
  const first = await links.nth(0).boundingBox();
  const second = await links.nth(1).boundingBox();
  const third = await links.nth(2).boundingBox();
  expect(first?.height).toBe(37);
  expect((third?.y ?? 0) - (second?.y ?? 0)).toBe(33);
  expect((second?.y ?? 0) - (first?.y ?? 0)).toBe(33);

  // A short window scrolls the menu inside; the logo and the slogan block stay in place.
  const menu = page.getByTestId('sidebar-menu');
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const slogan0 = await slogan.boundingBox();
  await menu.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await logo.boundingBox()).toEqual(box);
  expect(await slogan.boundingBox()).toEqual(slogan0);
  expect((slogan0?.y ?? 0) + (slogan0?.height ?? 0)).toBeLessThanOrEqual(900);
  await expect(links.last()).toBeInViewport();

  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('img', { name: 'LVP Accounting & Taxes' })).toBeVisible();
  await expect(footer.getByRole('link')).toHaveText(['Support']);
});

// A wide logo, a squarer one and one with transparent padding (a file with empty space around it
// always looks smaller): the box is as wide as the inner width unless 100 px of height cuts it.
for (const [name, file] of [
  ['wide', null],
  ['squarer', 'logo-square.png'],
  ['with transparent padding', 'logo-padded.png'],
] as const) {
  for (const size of [
    { width: 1440, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    test(`the sidebar logo fills the width: ${name} logo at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      if (file) {
        await page.route(/lvp-logo-dark.*\.png/, (route) =>
          route.fulfill({ path: new URL(`./assets/${file}`, import.meta.url).pathname }),
        );
      }
      await page.setViewportSize(size);
      await page.goto(app('/'));
      const logo = page.getByRole('navigation', { name: 'Main' }).locator('img');
      await expect(logo).toBeVisible();
      await expect
        .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
      const natural = await logo.evaluate(
        (img: HTMLImageElement) => img.naturalHeight / img.naturalWidth,
      );
      const box = await logo.boundingBox();
      expect(box?.x).toBe(20);
      expect(box?.width).toBe(200);
      // Limited by the width, or by 100 px when the logo is squarer.
      expect(box?.height).toBeCloseTo(Math.min(100, 200 * natural), 0);
      // Never more than 16 px above it and 20 px below it, as in the design.
      const first = await page.getByTestId('sidebar-menu').getByRole('link').first().boundingBox();
      expect(box?.y).toBe(16);
      expect((first?.y ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(18);
    });
  }
}

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
