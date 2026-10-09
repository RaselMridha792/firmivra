import { expect, test } from '@playwright/test';

// The setup wizard in mock mode: the settings mock starts Pending Setup with no step done.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner finishes the setup wizard', async ({ page }) => {
  await page.goto(app('/setup'));
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  const current = page.locator('[aria-current="step"]');
  await expect(current).toContainText('Branding');
  await expect(page.getByText('Sample Legal Name LLC')).toBeVisible();

  // Branding: a bad colour is caught; a good one shows in the preview.
  await page.getByLabel('Portal name').fill('Sample Client Portal');
  await page.getByLabel('Primary colour', { exact: true }).fill('navy');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Use a colour like #1d4ed8')).toBeVisible();
  await page.getByLabel('Primary colour', { exact: true }).fill('#1F3A6B');
  await expect(page.getByTestId('preview-bar')).toHaveText('Sample Client Portal');
  await expect(page.getByTestId('preview-bar')).toHaveCSS('background-color', 'rgb(31, 58, 107)');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Business details: Save draft, Back keeps saved values, and only the EIN's last 4 come back.
  await expect(current).toContainText('Business details');
  await page.getByLabel('EIN').fill('12-3456789');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Portal name')).toHaveValue('Sample Client Portal');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('EIN (saved, ends in 6789)')).toHaveValue('');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Team and access: an invite joins the list.
  await expect(current).toContainText('Team and access');
  await page.getByLabel('Name', { exact: true }).fill('Taylor Sample');
  await page.getByLabel('Email', { exact: true }).fill('taylor@lvp.test');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByTestId('team-member').filter({ hasText: 'Taylor Sample' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Client portal, then Finish: every step is done and the firm opens its dashboard.
  await expect(current).toContainText('Client portal');
  await page.getByLabel('Welcome message').fill('We are glad you are here.');
  await expect(page.getByTestId('brand-preview')).toContainText('We are glad you are here.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('finish-item').filter({ hasText: 'Done' })).toHaveCount(4);
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(page).toHaveURL(app('/'));
});

test('the wizard fits a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(app('/setup'));
  await expect(page.getByTestId('brand-preview')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
