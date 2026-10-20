import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [375, 768, 1024, 1440]) {
  test(`Firm Sign dashboard design fits ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1024 });
    // The mock requests are dated early October 2026 (expiry and the 30-day window follow them).
    await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
    // Clients are not included in the repo's API mock mode; isolate this visual spec.
    await page.route('**/api/v1/business/clients?*', (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.goto(`http://app.localhost:${port}/firm-sign`);
    await expect(page.getByTestId('page-title')).toHaveText('Firm Sign');
    const recent = page.getByTestId('firm-sign-recent-documents');
    const actions = page.getByTestId('firm-sign-quick-actions');
    if (width >= 1024) await expect(recent.getByRole('table')).toBeVisible();
    else {
      const cards = recent.getByTestId('firm-sign-document-cards');
      await expect(cards).toBeVisible();
      await expect(cards.getByText('Sent Date', { exact: true })).toHaveCount(5);
      await expect(cards.getByRole('link', { name: /^Open / })).toHaveCount(5);
      await expect(cards.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    }
    await expect(actions.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    await expect(page.getByTestId('firm-sign-how-it-works').getByRole('listitem')).toHaveCount(4);
    await expect(
      page.getByRole('navigation', { name: 'Requests by status' }).getByRole('link'),
    ).toHaveCount(9);
    const recentBox = await recent.boundingBox();
    const actionsBox = await actions.boundingBox();
    if (width >= 1280) expect(actionsBox!.x).toBeGreaterThan(recentBox!.x + recentBox!.width);
    else expect(actionsBox!.y).toBeGreaterThan(recentBox!.y + recentBox!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width >= 1024) {
      expect(
        await recent
          .getByRole('table')
          .evaluate((el) => el.parentElement!.scrollWidth <= el.parentElement!.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`firm-sign-${width}.png`), fullPage: true });
    await recent.getByRole('link', { name: 'View All', exact: true }).click();
    await expect(page).toHaveURL(/\/firm-sign\/requests$/);
  });
}
