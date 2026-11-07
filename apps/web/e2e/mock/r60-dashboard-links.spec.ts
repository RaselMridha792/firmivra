import { expect, test } from '@playwright/test';

// R60: the firm dashboard's Create Bulk Email, Upload Now and Tasks Due "View All" open the
// real modules (they built /modules/<slug>, which 404s once a module is real). Since Q3 and Q5
// (#1150) the first two open their creation workflows: the bulk email's start page, which creates
// nothing, and the secure upload.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

for (const [name, open, path] of [
  [
    'Create Bulk Email',
    (page) => page.getByRole('link', { name: 'Create Bulk Email' }),
    '/communications/new?channel=EMAIL',
  ],
  ['Upload Now', (page) => page.getByRole('link', { name: 'Upload Now' }), '/documents/upload'],
  [
    'Tasks Due, View All',
    (page) =>
      page.getByRole('region', { name: 'Tasks Due' }).getByRole('link', { name: 'View All' }),
    '/tasks',
  ],
] as const satisfies readonly [
  string,
  (page: import('@playwright/test').Page) => import('@playwright/test').Locator,
  string,
][]) {
  test(`${name} opens ${path}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`http://app.localhost:${port}/`);
    const link = open(page);
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    const escaped = path.replace(/[?.]/g, '\\$&');
    await expect(page).toHaveURL(new RegExp(`${escaped}$`), { timeout: 60_000 });
    await expect(page.getByText('Page not found')).toHaveCount(0);
  });
}
