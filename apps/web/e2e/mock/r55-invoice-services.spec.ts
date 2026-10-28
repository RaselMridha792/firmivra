import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F01: each line can come from any active
// Services & Pricing offering (not only the client's), filling its details and price; categories
// filter the list; a custom item stays possible and never becomes a service. Mock mode, as Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('a line fills from any offering, the category filters them, and a custom item stays free', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  await page.getByLabel('Client *').selectOption({ index: 1 });
  const service = page.getByLabel('Service 1', { exact: true });
  await expect(service.locator('option').first()).toHaveText('Custom item');
  const all = await service.locator('option').count();
  expect(all).toBeGreaterThan(2);

  // Picking an offering fills the description and, when it has one, the price.
  const first = (await service.locator('option').nth(1).getAttribute('value')) ?? '';
  await service.selectOption(first);
  await expect(page.getByLabel('Description 1 *')).not.toHaveValue('');
  await expect(page.getByLabel('Rate 1 *')).not.toHaveValue('');

  // A category narrows the choices; All categories brings them back.
  const category = page.getByLabel('Service category');
  await category.selectOption({ index: 1 });
  expect(await service.locator('option').count()).toBeLessThan(all);
  await category.selectOption('');
  await expect(service.locator('option')).toHaveCount(all);

  // A second line stays a custom item: typed, for this invoice only.
  await page.getByRole('button', { name: 'Add Line Item' }).click();
  await expect(page.getByLabel('Service 2', { exact: true })).toHaveValue('');
  await page.getByLabel('Description 2 *').fill('One-time document courier (fake)');
  await page.getByLabel('Rate 2 *').fill('25');
  await expect(page.getByText('A custom item is for this invoice only')).toBeVisible();
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/invoices/line-services.png',
    fullPage: true,
  });
});
