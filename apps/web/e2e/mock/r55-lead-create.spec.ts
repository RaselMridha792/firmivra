import { expect, test } from '@playwright/test';

// R55: Add New Lead saves a lead left Unassigned and with No campaign. Both are empty choices,
// which the form used to refuse without a word (found with L13). In mock mode as the Owner.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('saves a lead with no staff member and no campaign', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Quinn');
  await dialog.getByLabel('Last name').fill('Newfake');
  await dialog.getByRole('textbox', { name: 'Email' }).fill('quinn.newfake@example.test');
  await expect(dialog.getByLabel('Assigned staff')).toHaveValue('');
  await expect(dialog.getByLabel('Campaign', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('table', { name: 'Leads' }).getByRole('row', { name: /Quinn Newfake/ }),
  ).toHaveCount(1);
});
