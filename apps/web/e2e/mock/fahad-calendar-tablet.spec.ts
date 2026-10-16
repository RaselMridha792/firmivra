import { expect, test } from '@playwright/test';
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 768, 820, 1024, 1440]) {
  test(`calendar dates fit ${width}px without wrapping`, async ({ page }, info) => {
    await page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00'));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/calendar`);
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByTestId('appointment')).toHaveCount(5);
    const days = page.getByTestId('calendar-day');
    await expect(days).toHaveCount(7);
    for (const day of await days.all()) {
      const heading = day.getByRole('button').first();
      const lineCount = await heading.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      });
      expect(lineCount, await heading.innerText()).toBe(1);
      expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`calendar-${width}.png`), fullPage: true });
    await days.first().getByRole('button').first().click();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('appointment')).toHaveCount(2);
  });
}
