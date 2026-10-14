import { expect, test } from '@playwright/test';

// The firm sidebar (246 px, the design's width): its menu keeps scrolling with the scrollbar
// hidden, and a soft fade at its bottom edge shows while more items are below.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.use({ viewport: { width: 1280, height: 720 }, hasTouch: true });

test('the menu has no scrollbar, and nothing else loses its scrollbar', async ({ page }) => {
  await page.goto(app('/'));
  const menu = page.getByTestId('sidebar-menu');
  await expect(menu).toBeVisible();
  const style = await menu.evaluate((el: HTMLElement) => ({
    width: getComputedStyle(el).scrollbarWidth,
    gutter: el.offsetWidth - el.clientWidth,
    scrolls: el.scrollHeight > el.clientHeight,
  }));
  expect(style).toEqual({ width: 'none', gutter: 0, scrolls: true });
  // Only the menu: the page and the main area keep the browser's own scrollbars.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)).toBe(
    'auto',
  );
  expect(await page.locator('main').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe(
    'auto',
  );
});

test('the menu still scrolls by wheel, keyboard and touch, with a fade while items are below', async ({
  page,
}) => {
  await page.goto(app('/'));
  const nav = page.getByRole('navigation', { name: 'Main' });
  const menu = page.getByTestId('sidebar-menu');
  const fade = page.getByTestId('sidebar-menu-fade');
  const top = () => menu.evaluate((el: HTMLElement) => el.scrollTop);
  await expect(fade).toBeVisible();
  expect(await top()).toBe(0);
  const fadeBox = await fade.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(fadeBox?.height).toBe(24);
  expect((fadeBox?.y ?? 0) + (fadeBox?.height ?? 0)).toBeCloseTo(
    (menuBox?.y ?? 0) + (menuBox?.height ?? 0),
    0,
  );

  // Mouse wheel (and trackpad: the same wheel events).
  await page.mouse.move((menuBox?.x ?? 0) + 100, (menuBox?.y ?? 0) + 100);
  await page.mouse.wheel(0, 200);
  await expect.poll(top).toBeGreaterThan(100);
  await menu.evaluate((el) => el.scrollTo(0, 0));

  // Keyboard: Tab to a link below the fold scrolls it into view, arrow keys scroll further.
  const links = nav.getByTestId('sidebar-menu').getByRole('link');
  await links.first().focus();
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab');
  await expect.poll(top).toBeGreaterThan(0);
  const afterTab = await top();
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBeGreaterThan(afterTab);
  await menu.evaluate((el) => el.scrollTo(0, 0));

  // Touch: a swipe up.
  const client = await page.context().newCDPSession(page);
  const x = (menuBox?.x ?? 0) + 100;
  let y = (menuBox?.y ?? 0) + 380;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 0; i < 12; i++) {
    y -= 20;
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(top).toBeGreaterThan(100);

  // At the end of the list the fade is gone and the last item is visible.
  await menu.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(fade).toHaveCount(0);
  await expect(links.last()).toBeInViewport();
  // And it is back as soon as the list moves up.
  await menu.evaluate((el) => el.scrollTo(0, 0));
  await expect(fade).toBeVisible();
});

test('the mobile menu opens with the same sidebar and scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(app('/'));
  await page.getByRole('button', { name: /menu/i }).first().click();
  const menu = page.getByTestId('sidebar-menu').last();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await menu.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByRole('link', { name: 'Settings' })).toBeInViewport();
  expect((await page.getByRole('navigation', { name: 'Main' }).boundingBox())?.width).toBe(246);
});

test('the main area, header and footer sit next to the 246 px sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  const header = await page.getByRole('banner').boundingBox();
  const footer = await page.getByRole('contentinfo').boundingBox();
  expect(header?.x).toBe(246);
  expect(footer?.x).toBe(246);
  expect((header?.x ?? 0) + (header?.width ?? 0)).toBe(1440);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});
