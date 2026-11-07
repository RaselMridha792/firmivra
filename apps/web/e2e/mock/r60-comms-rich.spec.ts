import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review (playwright.mock.config.ts, as an Owner; the mock
// answers as the API): CM-F08 an image inserted in an email's or an announcement's content, CM-F10
// the five mail-safe fonts, and the preview showing them as the message will look. An announcement
// shows its formatting on the portal's Announcements page; the dashboard card keeps a text snippet.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
// A 1 x 1 PNG (synthetic).
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
test.use({ viewport: { width: 1440, height: 1000 } });

const start = async (page: Page, channel: 'EMAIL' | 'ANNOUNCEMENT') => {
  await page.goto(`${base}/new?channel=${channel}`);
  await page.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByTestId('composer')).toBeVisible();
};

for (const channel of ['EMAIL', 'ANNOUNCEMENT'] as const) {
  test(`${channel}: a font and an image in the content, and the preview shows them (CM-F08, CM-F10)`, async ({
    page,
  }) => {
    await start(page, channel);
    const content = page.getByRole('textbox', { name: 'Message' });
    const tools = page.getByRole('toolbar', { name: 'Message formatting' });
    await content.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Our office hours are changing.');
    await page.keyboard.press('Control+A');
    // CM-F10: the five mail-safe fonts.
    const font = tools.getByLabel('Font');
    await expect(font.locator('option')).toHaveText([
      'Font',
      'Arial',
      'Georgia',
      'Times New Roman',
      'Verdana',
      'Courier New',
    ]);
    await font.selectOption({ label: 'Georgia' });
    await expect(content.locator('span[style*="font-family"]')).toHaveText(
      'Our office hours are changing.',
    );
    // CM-F08: an image, uploaded to the firm's email images.
    await page.keyboard.press('Control+End');
    const chooser = page.waitForEvent('filechooser');
    await tools.getByRole('button', { name: 'Insert image' }).click();
    await (await chooser).setFiles({ name: 'hours.png', mimeType: 'image/png', buffer: png });
    await expect(content.locator('img')).toHaveCount(1);

    await page.getByRole('button', { name: 'Save Draft' }).first().click();
    const frame = page.frameLocator('[data-testid="composer-preview"]');
    await expect(frame.locator('img')).toHaveCount(1);
    await expect(frame.locator('span[style*="Georgia"]')).toHaveText(
      'Our office hours are changing.',
    );
  });
}

test('an SMS has no fonts or images: plain text (CM-F08)', async ({ page }) => {
  await page.goto(`${base}/new?channel=SMS`);
  await page.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByRole('button', { name: 'Insert image' })).toHaveCount(0);
  await expect(page.getByLabel('Font')).toHaveCount(0);
});

test("the portal's Announcements page shows the firm's formatting; the card keeps text (CM-F08)", async ({
  page,
}) => {
  await page.goto(portal('/lvp/intake'));
  const card = page.getByTestId('announcement-card');
  await expect(card).toContainText('to better serve you');
  await expect(card.getByTestId('announcement-html')).toHaveCount(0);
  await card.getByRole('link', { name: 'View All Announcements' }).click();
  await expect(page).toHaveURL(/\/lvp\/announcements$/);
  const hours = page.getByTestId('announcement-html').filter({ hasText: 'Saturdays' });
  await expect(hours.locator('p[style*="text-align:center"] span')).toHaveCSS(
    'font-family',
    /Georgia/,
  );
});
