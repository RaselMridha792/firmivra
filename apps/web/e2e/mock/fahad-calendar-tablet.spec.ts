import { expect, test } from '@playwright/test';

// Appointments > Calendar at phone, tablet and desktop widths (Fahad's #452, rewritten by R56 for
// the calendar after #681): the week shows its seven days, the page never scrolls sideways (the
// week grid scrolls inside its own frame), and each day's name and date stay on one line.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;

for (const width of [375, 768, 820, 1024, 1440]) {
  test(`the calendar week fits ${width}px without sideways page scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://app.localhost:${port}/calendar?date=2026-07-08`);
    const week = page.getByRole('group', { name: /^Week of / });
    await expect(week).toBeVisible({ timeout: 60_000 });
    await expect(week.getByRole('group')).toHaveCount(7);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The day headings: the first row of the week, one line per name and per date.
    const lines = await week.evaluate((el) =>
      [...(el.firstElementChild?.children ?? [])]
        .filter((c) => !c.getAttribute('aria-hidden'))
        .flatMap((c) =>
          [...c.children].map((part) => {
            const range = document.createRange();
            range.selectNodeContents(part);
            return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
          }),
        ),
    );
    expect(lines.length).toBeGreaterThanOrEqual(14);
    expect(lines.every((n) => n === 1)).toBe(true);
  });
}
