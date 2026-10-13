import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';

test.beforeEach(async ({ page }) => {
  // Invoice draft actions read clients; that module has no API mock implementation.
  await page.route('**/api/v1/business/clients/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    route.fulfill({
      json: clientFixtures().find((client) => client.id === id) ?? clientFixtures()[0],
    });
  });
});

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
for (const width of [320, 375, 768, 820, 1024, 1440]) {
  for (const route of [
    'leads',
    'calendar',
    'invoices',
    'workspaces',
    'team',
    'audit-log',
    'settings/profile',
  ]) {
    test(`${route} has no horizontal scrolling at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`http://app.localhost:${port}/${route}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (route === 'leads') {
        await page.getByLabel('Filter by status').selectOption('IN_REVIEW');
        await expect(page.getByLabel('Filter by status')).toHaveValue('IN_REVIEW');
      }
      if (route === 'invoices' || route === 'workspaces') {
        const id = route === 'invoices' ? 'invoices' : 'workspace';
        await expect(page.getByTestId(`${id}-${width < 1280 ? 'cards' : 'table'}`)).toBeVisible();
      }
      if (route === 'audit-log') {
        await expect(
          width < 1280
            ? page.getByTestId('audit-mobile-cards')
            : page.getByRole('table', { name: 'Audit log' }),
        ).toBeVisible();
      }
      if (route === 'calendar') await expect(page.getByTestId('calendar-range')).toBeVisible();
      if (route === 'settings/profile') await expect(page.getByLabel('Entity type')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const scrollbars = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main *')]
          .filter(
            (el) =>
              el.clientWidth > 0 &&
              ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) &&
              el.scrollWidth > el.clientWidth + 1,
          )
          .map((el) => el.className),
      );
      expect(scrollbars).toEqual([]);
      for (const select of await page.locator('select').all()) {
        if (!(await select.isVisible())) continue;
        const box = await select.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({
        path: info.outputPath(`${route.replace('/', '-')}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
