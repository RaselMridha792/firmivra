import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 768, 820, 1024, 1440]) {
  test(`calendar dates fit ${width}px without wrapping`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/calendar`);
    const week = page
      .getByTestId('appointments-calendar')
      .getByRole('group', { name: /^Week of / });
    await expect(week).toBeVisible({ timeout: 60_000 });
    // The seven day headings (weekday, then the date or today's circle) each keep one line.
    const heads = week.locator(':scope > div:first-child > span:not([aria-hidden])');
    await expect(heads).toHaveCount(7);
    for (const head of await heads.all()) {
      for (const line of await head.locator(':scope > span').all()) {
        const lineCount = await line.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        });
        expect(lineCount, await line.innerText()).toBe(1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`calendar-${width}.png`), fullPage: true });
  });
}
