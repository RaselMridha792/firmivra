import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (N8-33): a draft service ("Bookkeeping (Copy)" in the mock catalog) is
// neither a Clients tab nor a Service choice; the active services are both. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a draft service is no Clients tab and no Service choice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });
  const tabs = page.getByRole('tablist', { name: 'Client views' }).getByRole('tab');
  await expect(tabs.filter({ hasText: /^Bookkeeping/ })).toHaveCount(1);
  await expect(tabs.filter({ hasText: 'Bookkeeping (Copy)' })).toHaveCount(0);
  const service = page.getByLabel('Service', { exact: true });
  await expect(service.locator('option', { hasText: 'Tax Planning' })).toHaveCount(1);
  await expect(service.locator('option', { hasText: 'Bookkeeping (Copy)' })).toHaveCount(0);
});
