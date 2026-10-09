import { expect, test } from '@playwright/test';

// N09 and N10 in mock mode: the business client's resource pages and external links
// (mocks/content.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('a resource page lists its sections and links back to resources', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/resources/startup-guide'));
  await expect(page).toHaveTitle('Business Startup Guide');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Business Startup Guide');
  await expect(page.getByRole('heading', { name: 'Sole Proprietorship' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Limited Liability Company (LLC)' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Resources' })).toHaveAttribute(
    'href',
    '/lvp/business',
  );
  await page.screenshot({ path: testInfo.outputPath('startup-guide-1440.png'), fullPage: true });

  for (const [path, title, section] of [
    ['record-keeping', 'Record Keeping Best Practices', 'Income records'],
    ['payroll', 'Payroll Resources', 'Payroll setup steps'],
    ['tax-deductions', 'Tax Deductions for Small Businesses', 'Home office'],
  ] as const) {
    await page.goto(portal(`/lvp/resources/${path}`));
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  }
});

test('external links are grouped and open in a new tab', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/resources/external-links'));
  await expect(page).toHaveTitle('External Links');
  const irs = page.getByRole('region', { name: 'IRS & Business Taxes' });
  await expect(irs.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Funding & Financial Resources' })).toBeVisible();
  const link = irs.getByRole('link', { name: /irs\.gov\/ein/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await page.screenshot({ path: testInfo.outputPath('external-links-1440.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('external-links-375.png'), fullPage: true });
});
