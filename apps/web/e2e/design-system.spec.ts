import { test, expect } from '@playwright/test';

const storybook = 'http://localhost:6006/iframe.html?id=design-system-foundation--';
test('table sorts numerically and paginates', async ({ page }) => {
  await page.goto(`${storybook}components`);
  const table = page.getByRole('table', { name: 'Demo invoices' });
  await page.getByRole('button', { name: 'Amount' }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Alex');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.locator('tbody tr')).toContainText('Zoe');
});
test('tabs use arrow navigation; modal traps and restores focus', async ({ page }) => {
  await page.goto(`${storybook}components`);
  await page.getByRole('tab', { name: 'My Documents' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Invoices' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Your invoice list');
  const open = page.getByRole('button', { name: 'Open dialog' });
  await open.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(open).toBeFocused();
});
test('brand switching updates actions while status retains meaning', async ({ page }) => {
  await page.goto(`${storybook}tokens`);
  const action = page.getByRole('button', { name: 'Public action', exact: true });
  const paid = page.getByText('Paid', { exact: true });
  const before = await paid.evaluate((el) => getComputedStyle(el).color);
  await page.getByLabel('Theme', { exact: true }).selectOption('lvpPortal');
  await expect(action).toHaveCSS('background-color', 'rgb(197, 138, 22)');
  await expect(paid).toHaveCSS('color', before);
  await page.getByLabel('Theme', { exact: true }).selectOption('lvpBeginOnline');
  await expect(action).toHaveCSS('background-color', 'rgb(185, 71, 0)');
});
