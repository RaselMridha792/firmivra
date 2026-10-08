import { expect, test } from '@playwright/test';

// The setup wizard in mock mode: the settings mock starts Pending Setup with no step done.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner saves the branding step', async ({ page }) => {
  await page.goto(app('/setup'));
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  const current = page.locator('[aria-current="step"]');
  await expect(current).toContainText('Branding');
  await expect(page.getByText('Sample Legal Name LLC')).toBeVisible();

  // A bad colour is caught; a good one shows in the preview.
  await page.getByLabel('Portal name').fill('Sample Client Portal');
  await page.getByLabel('Primary colour', { exact: true }).fill('navy');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Use a colour like #1d4ed8')).toBeVisible();
  await page.getByLabel('Primary colour', { exact: true }).fill('#1F3A6B');
  await expect(page.getByTestId('preview-bar')).toHaveText('Sample Client Portal');
  await expect(page.getByTestId('preview-bar')).toHaveCSS('background-color', 'rgb(31, 58, 107)');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();

  // Continue opens step 2; Back shows the saved values.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(current).toContainText('Business details');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Portal name')).toHaveValue('Sample Client Portal');
  await expect(page.getByLabel('Primary colour', { exact: true })).toHaveValue('#1f3a6b');

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
