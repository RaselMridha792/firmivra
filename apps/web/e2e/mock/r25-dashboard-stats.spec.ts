import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = `http://admin.localhost:${port}`;

const stats = [
  'stat-pending-applications',
  'stat-active-firms',
  'stat-total-users',
  'stat-monthly-revenue',
];

for (const width of [1280, 1366, 1536]) {
  test(`each stat card's "View …" link stays on one line inside its card at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${admin}/`);
    await expect(page.getByTestId('stat-pending-applications-value')).toHaveText('4');
    await page.evaluate(() => document.fonts.ready);

    for (const testId of stats) {
      const card = page.getByTestId(testId);
      const link = card.getByText(/^View /);
      // One line: the link is no taller than its own line height.
      const lines = await link.evaluate((el) => {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      });
      expect(lines, `${testId} link lines`).toBe(1);

      const cardBox = (await card.boundingBox())!;
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.x + linkBox.width, `${testId} link right edge`).toBeLessThanOrEqual(
        cardBox.x + cardBox.width,
      );
    }
  });
}
