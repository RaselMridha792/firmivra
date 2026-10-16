import { expect, test } from '@playwright/test';
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/services-pricing/0199c0e0-0a00-7000-8000-000000000001`;
test('service preview and full view contain only public service content', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByTestId('service-client-preview')).toContainText(
    'Personal Tax Preparation',
  );
  await expect(page.getByTestId('service-client-preview')).not.toContainText('Internal');
  await page.getByRole('button', { name: 'View Full Page' }).click();
  await expect(page.getByTestId('service-full-preview')).toContainText("What's Included");
  await expect(page.getByRole('dialog')).not.toContainText('Internal Notes');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('missing service retains the preview, details and exclusions frames', async ({ page }) => {
  await page.goto(url.replace('000000000001', '999999999999'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service Details', exact: true })).toBeVisible();
  await expect(page.getByTestId('service-client-preview')).toBeVisible();
});
