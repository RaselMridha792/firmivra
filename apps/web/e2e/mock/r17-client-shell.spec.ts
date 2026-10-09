import { expect, test } from '@playwright/test';

// The client shell from docs/mockups/client-portal/My docs tab.png in mock mode: Firm Sign is on
// for lvp and the mock firm shares calculators, so both extra menu lines show.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the shell has the firm header, the menu with its extra lines, and the side cards', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/documents'));
  await expect(page.getByRole('link', { name: 'LVP Accounting & Taxes' })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Signatures' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Tax Calculators' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'My Documents' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const side = page.getByRole('complementary', { name: 'Help and shortcuts' });
  await expect(side.getByRole('link', { name: 'Send a Message' })).toBeVisible();
  await expect(side.getByRole('heading', { name: 'Upcoming Appointment' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'View Firm Documents' })).toHaveAttribute(
    'href',
    '/lvp/documents?source=firm',
  );
  await expect(page.getByRole('heading', { name: 'Quick Links' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('shell-1440.png'), fullPage: true });

  // The footer spans the page under the menu.
  const footer = await page.locator('footer').boundingBox();
  expect(footer?.x).toBe(0);

  await page.setViewportSize({ width: 375, height: 900 });
  await expect(menu).not.toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('shell-375.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Portal menu' })).toContainText(
    'LVP Accounting & Taxes',
  );
});

test('an unknown firm shows not found', async ({ page }) => {
  await page.goto(portal('/unknown-firm/documents'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
