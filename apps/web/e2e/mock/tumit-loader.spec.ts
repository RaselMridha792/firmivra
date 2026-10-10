import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = `http://admin.localhost:${port}`;

/**
 * Opens Firms from the dashboard with the new page's scripts held back, so the console's
 * loading.tsx shows in its place. Returns the function that lets them through.
 */
async function openFirmsSlowly(page: Page) {
  await page.goto(`${admin}/`);
  await expect(page.getByRole('heading', { name: 'Welcome back, Morgan!' })).toBeVisible();
  // The dev server builds the Firms page first; a plain fetch leaves its scripts unloaded.
  await page.evaluate(async () => (await fetch('/firms')).text());
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  // Every script asked for from here on is the Firms page's: the dev server never prefetches.
  await page.route(
    (url) => url.pathname.startsWith('/_next/static/'),
    async (route) => {
      await held;
      await route.continue();
    },
  );
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Firms' }).click();
  return release;
}

test('a page still loading shows the Firmivra loader inside the console', async ({ page }) => {
  const release = await openFirmsSlowly(page);

  const loader = page.getByTestId('brand-loader');
  await expect(loader).toBeVisible();
  await expect(loader).toHaveAttribute('role', 'status');
  // "Loading…" is there for screen readers only; on screen it is just the lockup.
  await expect(loader.getByText('Loading…')).toHaveClass(/sr-only/);
  await expect(loader.getByText('Super Admin Portal')).toBeVisible();
  // The lockup fades in and out, hidden from screen readers.
  await expect(loader.locator('[aria-hidden="true"]')).toHaveCSS('animation-name', 'pulse');
  // The sidebar and header stay around it.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  release();
  await expect(page.getByTestId('page-title')).toHaveText('Firms');
  await expect(loader).toHaveCount(0);
});

test.describe('with motion turned off', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the loader keeps still', async ({ page }) => {
    const release = await openFirmsSlowly(page);

    const lockup = page.getByTestId('brand-loader').locator('[aria-hidden="true"]');
    await expect(lockup).toBeVisible();
    await expect(lockup).toHaveCSS('animation-name', 'none');

    release();
    await expect(page.getByTestId('page-title')).toHaveText('Firms');
  });
});
