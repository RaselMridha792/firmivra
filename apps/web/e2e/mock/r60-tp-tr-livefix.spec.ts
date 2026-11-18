// R60, R61's live-check FAILs (Nov 18): Tax Planning C18 (its reports open in Reports) and the
// plan steps at 390 px, and Tax Returns F20b (a refused paper filing names the API's reason and
// its blockers). Tax Returns ACC-DOC is unit-tested (checklist-filter.test.ts). Mock mode, as an
// Owner, with the mock refusing what the API refuses. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('C18: the Tax Planning reports open in Reports, without a comparison their data cannot make', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const key of ['tax_plan_savings', 'tax_plans_by_status']) {
    await page.goto(app(`/reports/${key}?from=${encodeURIComponent('/tax-planning/reports')}`));
    await expect(page.getByTestId('report-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('This report is not available')).toHaveCount(0);
  }
});

test('390 px: no plan step scrolls sideways', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-planning/clients'));
  await page.getByTestId('tp-clients').getByLabel('Search clients or plans').fill('Sarah');
  await page
    .getByRole('link', { name: `${new Date().getFullYear()} Tax Plan` })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tax-planning\/plans\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const plan = /\/tax-planning\/plans\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const step of ['', '/financials', '/goals', '/implementation', '/review']) {
    await page.goto(app(`/tax-planning/plans/${plan}/edit${step}`));
    await expect(page.getByRole('navigation', { name: 'Plan steps' })).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), {
        message: `step ${step || '/'}`,
      })
      .toBeLessThanOrEqual(0);
  }
});
