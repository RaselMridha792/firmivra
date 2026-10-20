import { expect, test } from '@playwright/test';

// R61: the portal menu line lit on each page follows docs/mockups/client-portal
// (src/app/portal/[firmSlug]/(client)/_components/portal-menu.ts has the rule page by page).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

const pages: [path: string, lit: string][] = [
  ['/lvp/intake', 'Home'],
  ['/lvp/business', 'Home'],
  ['/lvp/documents', 'Home'],
  ['/lvp/taxes', 'Home'],
  ['/lvp/invoices', 'Home'],
  ['/lvp/resources/external-links', 'Home'],
  ['/lvp/messages', 'Messages'],
  ['/lvp/appointments', 'Appointments'],
  ['/lvp/services', 'My Services'],
  ['/lvp/profile', 'My Profile'],
];

// One test per page: each page's first visit compiles it in the dev server.
for (const [path, lit] of pages) {
  test(`${path} lights ${lit}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(portal(path));
    const menu = page.getByRole('navigation', { name: 'Main' });
    await expect(menu.getByRole('link', { name: lit })).toHaveAttribute('aria-current', 'page');
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
  });
}

test('Home opens the Intake Form tab and stays lit there', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/messages'));
  const menu = page.getByRole('navigation', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Messages' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await menu.getByRole('link', { name: 'Home' }).click();
  // The dev server compiles the /home redirect on its first visit.
  await expect(page).toHaveURL(/\/lvp\/intake$/, { timeout: 60_000 });
  await expect(menu.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('link', { name: 'Intake Forms' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});
