// R60, Octavia's Client Portal review (Nov 18): the side menu lights the line of the page itself,
// on its sub-pages too, and exactly one line at a time (aria-current="page"). Home is lit on Home
// and on the tab pages with no line of their own. Mock mode, as client Jamie. Synthetic data.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

const menuOf = (page: Page) => page.getByRole('navigation', { name: 'Main' });

/** Exactly one lit line, and it is `href`'s. */
async function litIs(page: Page, href: string) {
  const lit = menuOf(page).locator('[aria-current="page"]');
  await expect(lit).toHaveCount(1, { timeout: 60_000 });
  await expect(lit).toHaveAttribute('href', href);
}

test('every menu line is lit on its own page, and only it', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/home'));
  await expect(menuOf(page).getByRole('link', { name: 'Tax Calculators' })).toBeVisible({
    timeout: 60_000,
  });
  const hrefs = await menuOf(page)
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs).toEqual(expect.arrayContaining(['/lvp/home', '/lvp/documents', '/lvp/intake']));
  // Home opens the first My Client Portal tab, Intake Forms, which then lights its own line.
  const landing: Record<string, string> = { '/lvp/home': '/lvp/intake' };
  for (const href of hrefs) {
    await menuOf(page).locator(`a[href="${href}"]`).click();
    const at = landing[href] ?? href;
    await expect(page).toHaveURL(portal(at), { timeout: 60_000 });
    await litIs(page, at);
  }
});

test('a sub-page keeps its line lit, and the tab pages keep Home', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [path, line] of [
    ['/lvp/calculator/tax-bracket', '/lvp/calculator'],
    ['/lvp/requests/0199b6a6-0000-7000-8000-000000000024', '/lvp/documents'],
    ['/lvp/taxes', '/lvp/home'],
    ['/lvp/business', '/lvp/home'],
    ['/lvp/resources/payroll', '/lvp/home'],
  ] as const) {
    await page.goto(portal(path));
    await litIs(page, line);
  }
  // An invoice and an intake form, opened from their lists.
  for (const [list, prefix] of [
    ['/lvp/invoices', '/lvp/invoices/'],
    ['/lvp/intake', '/lvp/intake/'],
  ] as const) {
    await page.goto(portal(list));
    await page.locator(`main a[href^="${prefix}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${prefix}.+`), { timeout: 60_000 });
    await litIs(page, list);
  }
});

test('the mobile menu lights the same one line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(portal('/lvp/documents'));
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Portal menu' });
  const lit = drawer.locator('[aria-current="page"]');
  await expect(lit).toHaveCount(1, { timeout: 60_000 });
  await expect(lit).toHaveAttribute('href', '/lvp/documents');
});
