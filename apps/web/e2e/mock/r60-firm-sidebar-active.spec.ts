// R60, a guard for the firm sidebar (R61's nav check, Nov 18): one lit line (aria-current="page"),
// the page's own, and its parent line on every deeper page (the sidebar's longest match). Mock
// mode, as an Owner. Synthetic data only.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

const menuOf = (page: Page) => page.getByTestId('sidebar-menu');

async function litIs(page: Page, href: string) {
  const lit = menuOf(page).locator('[aria-current="page"]');
  await expect(lit).toHaveCount(1, { timeout: 60_000 });
  await expect(lit).toHaveAttribute('href', href);
}

test('every firm menu line is lit on its own page, and only it', async ({ page }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/'));
  await expect(menuOf(page).getByRole('link', { name: 'Payroll' })).toBeVisible({
    timeout: 60_000,
  });
  const hrefs = await menuOf(page)
    .getByRole('link')
    .evaluateAll((links) =>
      links
        .map((a) => a.getAttribute('href') ?? '')
        // Menu lines only: a badge link inside a line (Settings' "1 security alert to review",
        // /settings/security?alerts=open) carries a query and opens a view, not a line of its own.
        .filter((h) => h.startsWith('/') && !h.includes('?')),
    );
  expect(hrefs).toEqual(expect.arrayContaining(['/', '/clients', '/payroll', '/team']));
  for (const href of hrefs) {
    await menuOf(page).locator(`a[href="${href}"]`).first().click();
    // A line may open its first page (Settings opens /settings/profile).
    await expect
      .poll(
        () => {
          const path = new URL(page.url()).pathname;
          return path === href || path.startsWith(`${href === '/' ? '' : href}/`);
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await litIs(page, href);
  }
});

test('a deeper page keeps its line lit', async ({ page }) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [path, line] of [
    [`/clients/${JAMIE}`, '/clients'],
    ['/documents/upload', '/documents'],
    ['/calendar/new', '/calendar'],
    ['/intake-forms/send', '/intake-forms'],
    [`/client-portal/${JAMIE}`, '/client-portal'],
    ['/bookkeeping/clients/0199c0f0-b100-7000-8000-000000000001', '/bookkeeping'],
    ['/payroll/clients/0199c0f0-9c00-7000-8000-000000000001', '/payroll'],
    ['/tax-planning/clients', '/tax-planning'],
    ['/business-advisory/clients', '/business-advisory'],
    ['/messages/new', '/messages'],
    ['/reports/staff_team', '/reports'],
    ['/firm-sign/new', '/firm-sign'],
    ['/team/new', '/team'],
  ] as const) {
    await page.goto(app(path));
    await litIs(page, line);
  }
});
