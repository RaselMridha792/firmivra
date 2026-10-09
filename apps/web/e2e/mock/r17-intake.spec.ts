import { expect, test } from '@playwright/test';

// N06 Intake tab, part 1: the six form cards and a form's frame (its steps). The form itself
// comes with the portal intake API.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the intake cards open each form frame', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/intake'));
  await expect(page).toHaveTitle('Intake Form');
  const cards = page.getByRole('list', { name: 'Intake forms' });
  await expect(cards.getByRole('listitem')).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath('intake-1440.png'), fullPage: true });

  await cards.getByRole('link', { name: 'Go to Payroll Services Intake Form' }).click();
  await expect(page).toHaveURL(/\/lvp\/intake\/payroll$/);
  await expect(page.getByRole('list', { name: 'Form steps' })).toBeVisible();
  await expect(page.getByText("This form isn't open for you yet")).toBeVisible();
  await page.getByRole('link', { name: 'All intake forms' }).click();
  await expect(page).toHaveURL(/\/lvp\/intake$/);

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('intake-375.png'), fullPage: true });
});

test('an unknown form is not found', async ({ page }) => {
  const res = await page.goto(portal('/lvp/intake/not-a-form'));
  await expect(page.getByRole('list', { name: 'Form steps' })).toHaveCount(0);
  expect(res?.status()).toBeLessThan(500);
});
