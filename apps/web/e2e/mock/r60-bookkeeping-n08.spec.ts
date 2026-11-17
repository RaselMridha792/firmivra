// Octavia's Bookkeeping Review 2, N08 (G8): Terms opened from a workspace tab goes Back to
// that same tab. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('N08 (G8): Terms opened from a workspace tab goes Back to that same tab', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  const tabs = page.getByRole('tablist', { name: 'Client views' });
  await tabs.getByRole('tab', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/[?&]tab=reports/);
  await tabs.getByRole('tab', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\/[0-9a-f-]{36}\/terms/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(new RegExp(`/bookkeeping/clients/${GREEN}\\?tab=reports`));
  await expect(tabs.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
});
