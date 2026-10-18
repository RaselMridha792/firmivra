import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/services-pricing/inactive`;
test('inactive list filters and reactivates a service', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page.getByRole('table', { name: 'Inactive services' })).toContainText(
    'Amended Returns',
  );
  await page.getByTestId('inactive-search').fill('nothing-matches-example');
  await expect(
    page.getByRole('heading', { name: 'No matching services', exact: true }),
  ).toBeVisible();
  await page.getByTestId('inactive-search').fill('Amended');
  await page.getByRole('button', { name: 'Actions for Amended Returns' }).click();
  await page.getByRole('menuitem', { name: 'Activate', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Service usage');
  await page.getByRole('button', { name: 'Confirm activate' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
});
test('inactive cards fit mobile and tablet without page overflow', async ({ page }) => {
  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await expect(page.getByTestId('inactive-service-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
