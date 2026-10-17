import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/services-pricing/new`;

test('blank service validates, previews public content and saves an active service', async ({
  page,
}) => {
  await page.goto(url);
  await expect(page.getByTestId('service-name')).toHaveValue('');
  await page.getByTestId('save-activate').click();
  await expect(page.getByTestId('service-name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('service-name').fill('Annual review example');
  await page.getByTestId('service-category').selectOption({ label: 'Tax Preparation' });
  await page.getByLabel('Short Description *').fill('Annual review for a synthetic client.');
  await page.getByTestId('service-price').fill('125');
  await page.getByTestId('internal-notes').fill('Staff only note example');
  await expect(page.getByTestId('client-preview')).toContainText('Annual review example');
  await expect(page.getByTestId('client-preview')).not.toContainText('Staff only note example');
  await page.getByRole('button', { name: 'Add Line Item', exact: true }).click();
  await page.getByLabel('Item Name 1 *').fill('Review');
  await page.getByLabel('Price 1', { exact: true }).fill('125');
  await page.getByRole('button', { name: "Edit What's Included", exact: true }).click();
  await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  await page.getByLabel("What's Included item 1", { exact: true }).fill('Annual document review');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: '+ Add Add-On', exact: true }).click();
  await page.getByLabel('Add-On Name *').fill('Additional review');
  await page.getByLabel('Add-On Price', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Save Add-On', exact: true }).click();
  await expect(page.getByTestId('service-addon')).toContainText('Additional review');
  await page.getByRole('button', { name: 'View Full Page' }).click();
  await expect(page.getByRole('dialog')).not.toContainText('Staff only note example');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByTestId('save-activate').click();
  await expect(page).toHaveURL(/\/services-pricing$/);
  await expect(page.getByText('Annual review example', { exact: true })).toBeVisible();
});

test('service form stays within phone and tablet width and guards unsaved changes', async ({
  page,
}) => {
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await expect(page.getByTestId('service-form')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByTestId('service-name').fill('Unsaved example');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(page.getByTestId('service-name')).toHaveValue('Unsaved example');
});
