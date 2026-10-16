import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const id = '0199c0e0-0a00-7000-8000-000000000001';
const url = `http://app.localhost:${port}/services-pricing/${id}/edit`;
test('loads existing service and saves to the same record', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByTestId('service-name')).toHaveValue('Personal Tax Preparation');
  await expect(page.getByRole('switch', { name: 'Active service', exact: true })).toBeChecked();
  await page.getByTestId('service-name').fill('Personal Tax Review');
  await page.getByTestId('internal-notes').fill('Synthetic staff-only instructions');
  await expect(page.getByTestId('client-preview').first()).not.toContainText(
    'Synthetic staff-only instructions',
  );
  await page.getByTestId('save-changes').click();
  await expect(page).toHaveURL(/\/services-pricing$/);
  const savedRow = page.getByRole('row').filter({ hasText: 'Personal Tax Review' });
  await expect(savedRow).toBeVisible();
  await savedRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId('service-name')).toHaveValue('Personal Tax Review');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('unknown service keeps all form panels but prevents saving', async ({ page }) => {
  await page.goto(url.replace('000000000001', '999999999999'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await expect(page.getByTestId('service-form')).toBeVisible();
  await expect(page.getByTestId('save-changes')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back to Services', exact: true })).toBeEnabled();
});
