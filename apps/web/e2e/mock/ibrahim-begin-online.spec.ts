import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://portal.localhost:${port}`;
const services = [
  'annual-tax',
  'bookkeeping',
  'payroll',
  'business-development',
  'quarterly-tax',
  'tax-planning',
];

test('public service links stay within the firm', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const slug of ['lvp', 'firm-b']) {
    await page.goto(`${origin}/${slug}/begin`);
    await expect(page.getByRole('heading', { name: 'Begin Online', exact: true })).toBeVisible();
    for (const service of services) {
      await expect(page.getByTestId(`intake-${service}`)).toHaveAttribute(
        'href',
        `/${slug}/begin/${service}`,
      );
    }
    await expect(page.getByTestId('service-annual-tax')).toContainText(
      `${new Date().getFullYear()} tax return`,
    );
    await expect(page.getByRole('link', { name: 'Schedule an Appointment' })).toHaveCount(2);
  }
  await page.screenshot({ path: testInfo.outputPath('begin-desktop.png'), fullPage: true });
  await page.getByTestId('intake-annual-tax').click();
  await expect(page).toHaveURL(`${origin}/firm-b/begin/annual-tax`);
});

test('375px picker has no overflow and reachable actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}/lvp/begin`);
  await page.screenshot({ path: testInfo.outputPath('begin-mobile.png'), fullPage: true });
  for (const service of services) {
    const link = page.getByTestId(`intake-${service}`);
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    await expect(link).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});
