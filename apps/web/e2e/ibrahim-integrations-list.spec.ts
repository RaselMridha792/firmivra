import { expect, test } from '@playwright/test';

const port = process.env['WEB_PORT'] ?? '3000';
const base = `http://app.localhost:${port}`;

test('seeded owner opens the integration catalog through the real API', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/sign-in`);
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  const response = page.waitForResponse(
    (result) =>
      result.url().includes('/api/v1/business/integrations?') &&
      result.request().method() === 'GET',
  );
  await page.goto(`${base}/integrations`);
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  await expect(page.getByTestId('integration-card').first()).toBeVisible();
  for (const id of ['integration-health', 'integration-mapping', 'integration-activity']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('page-error')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('integrations-live-desktop.png'),
    fullPage: true,
  });
});
