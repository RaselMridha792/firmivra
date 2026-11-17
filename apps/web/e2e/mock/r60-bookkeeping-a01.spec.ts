// Octavia's Bookkeeping Review 2, E01a A01 (G10): Activity's View All opens the client's whole
// history, with Back to the workspace. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test("A01 (G10): Activity View All opens the client's whole history, with Back to the workspace", async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}`);
  await page.getByTestId('client-activity').getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/activity\?/);
  const back = page.getByTestId('back-to-origin');
  await expect(back).toHaveText('Back to Bookkeeping');
  await back.click();
  await expect(page).toHaveURL(`${app}/bookkeeping/clients/${GREEN}`);
  await expect(page.getByTestId('client-activity')).toBeVisible();
});
