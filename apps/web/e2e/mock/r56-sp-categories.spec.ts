import { expect, test } from '@playwright/test';

// R56: Services & Pricing > Service Categories in mock mode (every module on mock data, Owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/services-pricing/categories`;

test('keeps the header and the five tabs, with Service Categories active', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Services & Pricing', level: 1 })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Services & Pricing sections' });
  await expect(tabs.getByRole('link')).toHaveCount(5);
  await expect(tabs.locator('[aria-current="page"]')).toHaveText('Service Categories');
  await expect(page.getByTestId('category-rows').getByRole('row').first()).toBeVisible();
});

test('adds, reorders, deactivates, merges and deletes a category', async ({ page }) => {
  await page.goto(url);
  const names = page.getByTestId('category-name');
  await expect(names.first()).toBeVisible();
  const before = await names.count();

  await page.getByRole('button', { name: 'Add Category' }).click();
  await page.getByLabel('Category name').fill('Estate Planning');
  await page.getByRole('button', { name: 'Add Category' }).last().click();
  await expect(page.getByText('Category added.')).toBeVisible();
  await expect(names).toHaveCount(before + 1);
  await expect(names.last()).toHaveText('Estate Planning');

  // The same name again is the API's own message.
  await page.getByRole('button', { name: 'Add Category' }).click();
  await page.getByLabel('Category name').fill('Estate Planning');
  await page.getByRole('button', { name: 'Add Category' }).last().click();
  await expect(page.getByText('A category with this name already exists')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Move Estate Planning up' }).click();
  await expect(names.nth(before - 1)).toHaveText('Estate Planning');

  await page.getByRole('button', { name: /^Deactivate\s*Estate Planning/ }).click();
  await expect(page.getByText('Estate Planning deactivated.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Estate Planning' }).click();
  await page.getByRole('button', { name: 'Delete Category' }).click();
  await expect(page.getByText('Estate Planning deleted.')).toBeVisible();
  await expect(names).toHaveCount(before);
});

test('a category in use cannot be deleted, it can be merged', async ({ page }) => {
  await page.goto(url);
  const first = page.getByTestId('category-name').first();
  const name = (await first.textContent()) ?? '';
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('button', { name: 'Delete Category' }).click();
  await expect(page.getByText('Move or merge its services first.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: `Merge ${name}` }).click();
  await page.getByLabel('Move its services into').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Merge Category' }).click();
  await expect(page.getByText(`${name} merged.`)).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(url);
  await expect(page.getByTestId('categories-card')).toBeVisible();
  await page.waitForTimeout(500);
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
});
