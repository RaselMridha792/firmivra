// The portal's folder tabs (Intake Form, Business Documents & Resources, My Uploaded Documents,
// Tax Returns, Receipts & Invoices, Messages and Notes): all six on one row on a desktop, as in
// `Messages and notes.png`, and wrapped into a grid on smaller screens, never hidden off to the
// side. Rebuilt from Fahad's design-review draft #473.
import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;

for (const width of [375, 768, 1024, 1280, 1440]) {
  test(`folder tabs and messages fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://portal.localhost:${port}/lvp/messages`);
    await expect(
      page.getByRole('heading', { name: 'Messages and Notes', exact: true }),
    ).toBeVisible();

    const folders = page.getByRole('navigation', { name: 'Portal folders' });
    const tabs = folders.getByRole('link');
    expect(await tabs.count()).toBe(6);
    expect(await folders.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const navBox = (await folders.boundingBox())!;
    for (const tab of await tabs.all()) {
      await expect(tab).toBeVisible();
      const box = (await tab.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(navBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);
    }
    await expect(folders.getByRole('link', { name: 'Messages and Notes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // On a desktop the six tabs sit on one row.
    if (width >= 1280) {
      const tops = new Set(
        await Promise.all(
          (await tabs.all()).map(async (t) => Math.round((await t.boundingBox())!.y)),
        ),
      );
      expect(tops.size).toBe(1);
    }

    // The messages table may scroll inside its own frame (the kit's Table on narrow screens); the
    // page itself never scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`folder-tabs-${width}.png`), fullPage: true });
  });
}
