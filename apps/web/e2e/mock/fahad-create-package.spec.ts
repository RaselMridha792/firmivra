import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/services-pricing/packages/new`;

test('package picks unique services, uses API savings, keeps notes private and saves', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByTestId('package-save-activate').click();
  await expect(page.getByTestId('package-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('package-name').fill('Annual business bundle example');
  await page.getByTestId('package-category').selectOption({ label: 'Tax Preparation' });
  await page.getByLabel('Short Description *').fill('Services for a synthetic business.');
  await page.getByTestId('package-price').fill('400');
  await page.getByRole('button', { name: 'Add Service', exact: true }).click();
  await page.getByRole('button', { name: 'Add Business Tax Preparation', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add Business Tax Preparation', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Add Bookkeeping Services', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('selected-package-service')).toHaveCount(2);
  await expect(page.getByTestId('package-total')).toHaveText('$489.00');
  await expect(page.getByTestId('package-savings')).toContainText('$89.00');
  await expect(
    page.getByText('Variable-price services are included.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add Add-On', exact: true }).click();
  await page.getByLabel('Add-On Name *').fill('Extra annual review');
  await page.getByLabel('Add-On Price', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Save Add-On', exact: true }).click();
  await expect(page.getByTestId('package-addon-row')).toContainText('Extra annual review');
  await page.getByTestId('package-internal-notes').fill('Synthetic staff-only package note');
  await expect(page.getByTestId('package-client-preview')).not.toContainText(
    'Synthetic staff-only',
  );
  await page.getByRole('button', { name: 'View Full Page', exact: true }).click();
  await expect(page.getByTestId('package-full-preview')).toContainText('Extra annual review');
  await expect(page.getByTestId('package-full-preview')).not.toContainText('Synthetic staff-only');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByTestId('package-save-activate').click();
  await expect(page).toHaveURL(/\/services-pricing\/packages$/);
});

test('cancel protects a changed package', async ({ page }) => {
  await page.goto(url);
  await page.getByTestId('package-name').fill('Unsaved example');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved package changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(page.getByTestId('package-name')).toHaveValue('Unsaved example');
});

test('preview uses the API price when a percentage discount determines the price', async ({
  page,
}) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Add Service', exact: true }).click();
  await page.getByRole('button', { name: 'Add Bookkeeping Services', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('package-price').fill('');
  await page.getByLabel('Discount (Optional)').selectOption('PERCENTAGE');
  await page.getByLabel('Discount percentage').fill('20');
  await expect(page.getByTestId('package-client-preview')).toContainText('$159.20');
  await expect(page.getByTestId('package-savings')).toContainText('$39.80');
});
