import { expect, test } from '@playwright/test';

// Appointments D3, the inline booking embed, in mock mode (playwright.mock.config.ts, which lists
// https://site.example.test in EMBED_ALLOWED_ORIGINS). The firm copies the frame code and the
// button; the booking page, framed by an allowed site, posts its height and opens its sign-in
// and sign-up links in a new tab; another site's frame is refused by the page's header.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const TAX = '0199b6c2-0000-7000-8000-000000000001';
const SITE = 'https://site.example.test';
const OTHER = 'https://other.example.test';

const frameHost = (src: string) =>
  `<!doctype html><html><body><iframe id="f" src="${src}" style="width:800px;height:480px;border:0"></iframe></body></html>`;

test('Copy Embed Code shows the iframe code, the button, and that the website must be listed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/calendar/types'));
  const list = page.getByTestId('types-list');
  await list.getByRole('button', { name: 'Actions for Tax consultation' }).click();
  await page.getByRole('menuitem', { name: 'Copy Embed Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Embed Code for Tax consultation' });
  await expect(dialog.getByTestId('embed-allowed-note')).toContainText('must be listed');
  const code = dialog.getByRole('textbox', { name: /^embed code/i });
  await expect(code).toHaveValue(/^<iframe id="firmivra-/);
  await expect(code).toHaveValue(new RegExp(`src="https?://[^"]+/lvp/book/${TAX}"`));
  await expect(code).toHaveValue(/title="Book Tax consultation"/);
  await expect(code).toHaveValue(/e\.origin!==o/);
  const button = dialog.getByRole('textbox', { name: /button that opens the booking page/ });
  await expect(button).toHaveValue(/^<a href="https?:\/\/[^"]+" target="_blank" rel="noopener"/);
});

test('the booking page framed by an allowed site posts its height and opens sign-in in a new tab', async ({
  page,
}) => {
  await page.route(`${SITE}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: frameHost(portal(`/lvp/book/${TAX}`)) }),
  );
  await page.addInitScript(() => {
    (window as unknown as { heights: unknown[] }).heights = [];
    window.addEventListener('message', (e) =>
      (window as unknown as { heights: unknown[] }).heights.push(e.data),
    );
  });
  await page.goto(`${SITE}/book`);
  const frame = page.frameLocator('#f');
  await expect(frame.getByTestId('booking-link-type')).toHaveText('Tax consultation');

  // The height: the type's number only, and a positive one.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heights: unknown[] }).heights))
    .toEqual(expect.arrayContaining([{ type: 'firmivra:height', height: expect.any(Number) }]));
  const heights = await page.evaluate(() => (window as unknown as { heights: unknown[] }).heights);
  for (const h of heights as { type: string; height: number }[]) {
    expect(Object.keys(h).sort()).toEqual(['height', 'type']);
    expect(h.height).toBeGreaterThan(0);
  }

  // Sign-in and sign-up open in a new tab, never in the frame.
  for (const name of ['Sign In to Book', 'Create an account']) {
    const link = frame.getByRole('link', { name: new RegExp(name) });
    const popup = page.waitForEvent('popup');
    await link.click();
    const tab = await popup;
    await expect(tab).toHaveURL(/\/lvp\/sign-(in|up)/);
    await tab.close();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
  }
  await expect(frame.getByTestId('booking-link-type')).toBeVisible();
});

test('outside a frame the page is unchanged, and only the booking route sets frame-ancestors', async ({
  page,
}) => {
  await page.goto(portal(`/lvp/book/${TAX}`));
  await expect(page.getByTestId('booking-link-type')).toHaveText('Tax consultation');
  const signIn = page.getByRole('link', { name: /Sign In to Book/ });
  await expect(signIn).not.toHaveAttribute('target', /.+/);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-framed'))).toBe(
    false,
  );

  const book = await page.request.get(portal(`/lvp/book/${TAX}`));
  expect(book.headers()['content-security-policy']).toBe(`frame-ancestors ${SITE}`);
  expect(book.headers()['content-security-policy']).not.toContain(OTHER);
  const home = await page.request.get(portal('/lvp'));
  expect(home.headers()['content-security-policy']).toBeUndefined();
  const appPage = await page.request.get(app('/calendar/types'));
  expect(appPage.headers()['content-security-policy']).toBeUndefined();
});
