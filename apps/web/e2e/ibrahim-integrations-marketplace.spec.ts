import { expect, test } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const base = `http://app.localhost:${port}`;

test('seeded owner opens the marketplace through the real API', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/sign-in`);
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  const catalog = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/business/integrations/marketplace?') &&
      response.request().method() === 'GET',
  );
  await page.goto(`${base}/integrations/marketplace`);
  expect((await catalog).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Add Integration', exact: true })).toBeVisible();
  await expect(page.getByTestId('marketplace-integration').first()).toBeVisible();
  await page
    .getByTestId('marketplace-request')
    .getByRole('button', { name: 'Request Integration', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByLabel('Provider / software name')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('marketplace-live-desktop.png'),
    fullPage: true,
  });
});
