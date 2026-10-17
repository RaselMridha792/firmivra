import { expect, test } from '@playwright/test';

// R56: Services & Pricing > Package Builder (list, detail, edit) and Discounts & Promotions in
// mock mode (every module on mock data, Owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/services-pricing`;

test('Packages: the list, then one package read-only', async ({ page }) => {
  await page.goto(`${base}/packages`);
  const tabs = page.getByRole('navigation', { name: 'Services & Pricing sections' });
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Package Builder');
  const names = page.getByTestId('package-name');
  await expect(names.first()).toBeVisible();
  const name = (await names.first().textContent()) ?? '';
  await names.first().click();
  await expect(page.getByTestId('package-title')).toHaveText(name);
  for (const id of ['detail-services', 'detail-pricing', 'detail-addons', 'detail-preview']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('detail-preview')).not.toContainText('Internal');
});

test('Duplicate makes a draft copy and opens it in the builder', async ({ page }) => {
  await page.goto(`${base}/packages`);
  await page
    .getByRole('button', { name: /^Duplicate/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/packages\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByTestId('package-builder')).toBeVisible();
  await expect(page.getByLabel('Package Name *')).toHaveValue(/\(Copy\)/);
});

test('Builder: services, pricing, add-ons and settings, then save', async ({ page }) => {
  await page.goto(`${base}/packages`);
  await page.getByRole('link', { name: /^Edit/ }).first().click();
  await expect(page.getByTestId('builder-info')).toBeVisible();
  await expect(page.getByTestId('builder-service-rows').getByRole('row').first()).toBeVisible();
  await expect(page.getByTestId('builder-total')).not.toHaveText('$0.00');
  await expect(page.getByTestId('builder-savings')).toContainText('Client Savings');

  await page.getByLabel('Package Name *').fill('Edited Bundle');
  await page.getByRole('button', { name: 'Add Add-On' }).click();
  await page
    .getByLabel(/^Add-on \d+ name$/)
    .last()
    .fill('Extra Review');
  await page
    .getByLabel(/^Add-on \d+ price$/)
    .last()
    .fill('75');
  await expect(page.getByTestId('builder-preview')).toContainText('Extra Review (+$75.00)');

  // Remove the first service from the package only, then add one back from the picker.
  const before = await page.getByTestId('builder-service-name').count();
  await page
    .getByRole('button', { name: /^Remove .* from the package$/ })
    .first()
    .click();
  await expect(page.getByTestId('builder-service-name')).toHaveCount(before - 1);
  await page.getByRole('button', { name: 'Add Service' }).click();
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /^Done/ }).click();
  await expect(page.getByTestId('builder-service-name')).toHaveCount(before);

  await page.getByTestId('package-save').click();
  await expect(page).toHaveURL(/\/packages\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('package-title')).toHaveText('Edited Bundle');
  await expect(page.getByTestId('detail-addons')).toContainText('Extra Review');
});

test('Promotions: creates one, shows it, and ends it', async ({ page }) => {
  await page.goto(`${base}/promotions`);
  const tabs = page.getByRole('navigation', { name: 'Services & Pricing sections' });
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Discounts & Promotions');
  await page.getByRole('button', { name: 'Create Promotion' }).click();
  await page.getByLabel('Promotion name').fill('Spring Saver');
  await page.getByLabel('Percent off').fill('10');
  await page.getByLabel('Promo code (optional)').fill('SPRING10');
  await page.getByRole('button', { name: 'Save & Activate' }).click();
  await expect(page.getByText('Promotion saved and activated.')).toBeVisible();
  const row = page
    .getByTestId('promotion-rows')
    .getByRole('row')
    .filter({ hasText: 'Spring Saver' });
  await expect(row).toContainText('10% off');
  await expect(row).toContainText('SPRING10');
  await page.getByRole('button', { name: /^End\s*Spring Saver/ }).click();
  await expect(page.getByText('Spring Saver ended.')).toBeVisible();
});

test('Promotions: a percentage above 100 is refused before any request', async ({ page }) => {
  await page.goto(`${base}/promotions`);
  await page.getByRole('button', { name: 'Create Promotion' }).click();
  await page.getByLabel('Promotion name').fill('Too much');
  await page.getByLabel('Percent off').fill('150');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${base}/packages`);
  const href = await page.getByTestId('package-name').first().getAttribute('href');
  for (const path of [
    '/packages',
    href?.replace('/services-pricing', '') ?? '',
    `${href}/edit`.replace('/services-pricing', ''),
    '/promotions',
    '/categories',
  ]) {
    await page.goto(`${base}${path}`);
    await expect(
      page.locator('[data-testid^="catalog-"], [data-testid^="package-"]').first(),
    ).toBeVisible();
    await page.waitForTimeout(600);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path).toBeLessThanOrEqual(1);
  }
});
