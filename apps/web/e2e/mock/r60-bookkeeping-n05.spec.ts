// Octavia's Bookkeeping Review 2, N05 original (G7): Create Task from the workspace starts on
// the engagement's service, and Cancel goes back to the workspace. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('N05 (G7): Create Task starts on the Bookkeeping service, and Cancel goes back to the workspace', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}?tab=overview`);
  await expect(page.getByTestId('quick-actions')).toBeVisible();
  const origin = page.url();
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  await expect(page).toHaveURL(/\/tasks\/new\?/);
  const service = page.locator('#tf-service');
  await expect(service).not.toHaveValue('');
  await expect(service.locator('option:checked')).toHaveText(/Bookkeeping/i);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Not the general Tasks list: the workspace it was opened from.
  await expect(page).toHaveURL(origin);
  await expect(page.getByTestId('quick-actions')).toBeVisible();
});
