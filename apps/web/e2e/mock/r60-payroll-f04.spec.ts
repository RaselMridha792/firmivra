// Octavia's Payroll Review 2, F04: Create Task from Payroll fills in the Payroll service, and
// Cancel goes back to the exact page. Mock mode, as an Owner, on Green Leaf Café's payroll.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('F04: Create Task fills in the Payroll service, and Cancel goes back to the exact page', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}?tab=overview`);
  const actions = page.getByTestId('quick-actions');
  await expect(actions).toBeVisible();
  const origin = page.url();
  await actions.getByRole('link', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?/);
  const service = page.locator('#tf-service');
  await expect(service).not.toHaveValue('');
  await expect(service.locator('option:checked')).toHaveText(/Payroll/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Not the general Tasks list: the Payroll page it was opened from.
  await expect(page).toHaveURL(origin);
  await expect(page.getByTestId('quick-actions')).toBeVisible();
});
