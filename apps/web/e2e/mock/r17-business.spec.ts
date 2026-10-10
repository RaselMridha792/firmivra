import { expect, test } from '@playwright/test';

// N09 Business tab in mock mode: the firm's shared files (mocks/documents.ts), the open requests,
// the services (mocks/engagements.ts) and the resource pages.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the Business tab shows shared files, action items, services and resources', async ({
  page,
}, testInfo) => {
  await page.goto(portal('/lvp/business'));
  await expect(page).toHaveTitle('Business Documents & Resources');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Business Documents & Resources',
  );
  const files = page.getByRole('table', { name: 'Your business documents' });
  await expect(files).toContainText('Engagement_Letter_2025.pdf');
  await expect(files).not.toContainText('Driver_License.jpg');
  await expect(files).not.toContainText('Preparer_Worksheet.pdf');

  await expect(page.getByRole('list', { name: 'Business Action Items' })).toBeVisible();
  const services = page.getByRole('list', { name: 'My Business Services' });
  await expect(services).toContainText('Bookkeeping (Growth)');
  await expect(services).not.toContainText('2024 Personal Tax');

  await page
    .getByRole('list', { name: 'Helpful Resources' })
    .getByRole('link', { name: /Payroll Resources/ })
    .click();
  await expect(page).toHaveURL(/\/lvp\/resources\/payroll$/);
  await page.goBack();
  await page.screenshot({ path: testInfo.outputPath('business-1440.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('business-375.png'), fullPage: true });
});
