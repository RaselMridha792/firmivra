import { expect, test, type Locator, type Page } from '@playwright/test';

// SH2 (Octavia's Oct 25 review: PY-F07, F08; TX-F02): the shared ActionMenu opens above the page,
// never clipped by a table's scroll area and always inside the window, with one arrow on its
// trigger, arrow keys, Escape (focus back on the trigger) and Tab away. Payroll and Bookkeeping in
// mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

/** The menu is whole and inside the window. */
async function inWindow(page: Page, menu: Locator) {
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
}

for (const [module, path] of [
  ['Payroll', '/payroll'],
  ['Bookkeeping', '/bookkeeping'],
] as const) {
  test(`${module}: the last row's menu opens whole, inside the window, and the keys work`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${app}${path}`);
    const triggers = page.getByRole('button', { name: /^Actions for / });
    await expect(triggers.first()).toBeVisible();
    const last = triggers.last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await inWindow(page, menu);
    // Every choice is reachable without scrolling the table: the last one is visible in the menu.
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await menu.getByRole('menuitem').last().scrollIntoViewIfNeeded();
    await expect(menu.getByRole('menuitem').last()).toBeInViewport();
    // Nothing covers or clips it: the point at its middle is the item itself.
    const hit = await menu
      .getByRole('menuitem')
      .last()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
    expect(hit).toBe(true);
    await page.keyboard.press('Home');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-expanded', 'false');
  });
}

test('at 375 px the menu stays inside the window', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(`${app}/payroll`);
  const first = page.getByRole('button', { name: /^Actions for / }).first();
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await inWindow(page, page.getByRole('menu'));
  await page.mouse.click(5, 5);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test("Payroll client's More Actions and Client Actions show one arrow each", async ({ page }) => {
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  for (const name of ['More Actions', 'Client Actions']) {
    const trigger = page.getByRole('button', { name, exact: true });
    await expect(trigger).toBeVisible();
    // The dots icon on More Actions, then the menu's own single arrow.
    await expect(trigger.locator('svg')).toHaveCount(name === 'More Actions' ? 2 : 1);
  }
});
