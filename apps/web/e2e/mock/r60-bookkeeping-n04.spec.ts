// Octavia's Bookkeeping Review 2, N04 (G6): Client Notes' View All and the Notes tab open
// this workspace's own Notes, not the client's profile. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test("N04 (G6): Client Notes View All and the Notes tab open this workspace's Notes", async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  await page.getByTestId('shared-notes').getByRole('button', { name: 'View All' }).click();
  await expect(page.getByTestId('bk-notes')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/bookkeeping/clients/${GREEN}\\?tab=notes`));

  const tabs = page.getByRole('tablist', { name: 'Client views' });
  await tabs.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByTestId('bk-notes')).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByTestId('bk-notes')).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.getByTestId('bk-notes')).toBeVisible();
});
