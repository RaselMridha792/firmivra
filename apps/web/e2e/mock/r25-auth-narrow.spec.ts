import { expect, test } from '@playwright/test';

// From 1024 px up, the sign-in copy on the art panel stays clear of the card.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const pages = [
  `http://admin.localhost:${port}/sign-in`,
  `http://app.localhost:${port}/forgot-password`,
];

for (const width of [1024, 1152, 1280, 1440]) {
  test(`the panel copy stays left of the card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const url of pages) {
      await page.goto(url);
      await expect(page.locator('.auth-card')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const { copyRight, cardLeft } = await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('.auth-copy')!);
        const rights = [...range.getClientRects()].map((rect) => rect.right);
        return {
          copyRight: Math.max(...rights),
          cardLeft: document.querySelector('.auth-card')!.getBoundingClientRect().left,
        };
      });
      expect(copyRight, url).toBeLessThanOrEqual(cardLeft);
    }
  });
}
