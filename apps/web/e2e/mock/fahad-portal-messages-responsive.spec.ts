import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
test('current note and reminder controls still save in mock mode', async ({ page }) => {
  await page.goto(`http://portal.localhost:${port}/lvp/messages`);
  await page.getByLabel('Your note').fill('Synthetic reminder for design regression.');
  await page.getByLabel('Set a reminder', { exact: true }).check();
  await page.getByLabel('Remind me on').fill('2099-01-20T09:00');
  await page.getByRole('button', { name: 'Save Note', exact: true }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();
});
for (const width of [375, 768, 1024, 1280, 1440]) {
  test(`portal messages fit ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://portal.localhost:${port}/lvp/messages`);
    await expect(
      page.getByRole('heading', { name: 'Messages and Notes', exact: true }),
    ).toBeVisible();
    const list = page.getByTestId('portal-messages-list');
    await expect(list.getByRole('table', { name: 'Messages' })).toBeVisible();
    expect(
      await list
        .locator('table')
        .evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth),
    ).toBe(true);
    const viewButtons = list.getByRole('button', { name: /^View / });
    for (const button of await viewButtons.all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const folders = page.getByRole('navigation', { name: 'Portal folders' });
    expect(await folders.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(folders.getByRole('link', { name: 'Messages and Notes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (width < 1280) {
      for (const row of await list.locator('tbody tr').all()) {
        await expect(row.getByText('Date', { exact: true })).toBeVisible();
        await expect(row.getByText('Actions', { exact: true })).toBeVisible();
      }
    }
    const previous = await list
      .getByRole('button', { name: 'Previous', exact: true })
      .boundingBox();
    const next = await list.getByRole('button', { name: 'Next', exact: true }).boundingBox();
    expect(Math.abs(previous!.y - next!.y)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`messages-${width}.png`), fullPage: true });
    await page
      .getByRole('button', { name: /^Send a Message/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: 'Send a Message', exact: true });
    await expect(dialog.getByLabel('Subject')).toBeVisible();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
  });
}
