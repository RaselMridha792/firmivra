import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://app.localhost:${port}`;
const url = `${origin}/services-pricing`;

test('shows the catalog summary, active services, filters and pagination', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);

  await expect(page).toHaveTitle(/^Services & pricing/);
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Services & Pricing', level: 1 })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Service summary' });
  for (const label of [
    '12',
    'Total Services',
    '10',
    'Active Services',
    '2',
    'Inactive Services',
    '4',
    'Categories',
    '3',
    'Active Promotions',
  ]) {
    await expect(summary).toContainText(label);
  }

  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('Personal Tax Preparation');
  await expect(rows.first()).toContainText('$99.00+');
  await expect(page.getByText('Showing 1–8 of 10 services')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('services-pricing-desktop.png'),
    fullPage: true,
  });

  await page.getByLabel('Search services').fill('Tax Planning');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Tax Planning');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByLabel('Search services').fill('');
  await expect(rows).toHaveCount(8);

  await page.getByLabel('Filter by category').selectOption({ label: 'Advisory' });
  await expect(rows).toHaveCount(3);
  await expect(rows).toContainText([
    'Tax Planning',
    'Business Planning & Development',
    'Business Entity Formation',
  ]);
  await page.getByLabel('Filter by category').selectOption({ label: 'All Categories' });

  const priceHeading = page.getByRole('button', { name: /Pricing/ }).locator('..');
  await priceHeading.click();
  await expect(priceHeading).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('Showing 9–10 of 10 services')).toBeVisible();
});

test('keeps the page inside a 375 px viewport and exposes the service tabs', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);

  await expect(page.getByRole('tablist', { name: 'Services & Pricing sections' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.screenshot({
    path: test.info().outputPath('services-pricing-mobile.png'),
    fullPage: true,
  });
  const contentWidth = await page.getByTestId('services-pricing-page').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(contentWidth.scroll).toBeLessThanOrEqual(contentWidth.client);
});
