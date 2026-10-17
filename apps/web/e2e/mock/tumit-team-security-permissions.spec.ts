import { expect, test } from '@playwright/test';

// Access & Security, Permissions tab (/team/[id]/security/permissions), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('shows the grid, gives one extra permission after asking, then resets to the role', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/permissions`);
  await expect(page).toHaveTitle('Staff security: Permissions');
  await expect(page.getByTestId('permissions-summary')).toContainText('No changes for this person');
  const grid = page.getByTestId('effective-permissions');
  // Read-only until Edit Permissions.
  await expect(grid.getByRole('checkbox').first()).toBeDisabled();

  await grid.getByRole('button', { name: 'Edit Permissions' }).click();
  const box = grid.getByRole('checkbox', { name: /Settings.*View/ }).first();
  await box.check();
  await grid.getByRole('button', { name: 'Save Changes' }).click();
  const ask = page.getByRole('dialog', { name: 'Give more than the role allows?' });
  await ask.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(page.getByTestId('permissions-result')).toHaveText('Permissions saved.');
  await expect(page.getByTestId('permissions-summary')).toContainText('1 change for this person');
  await expect(page.getByTestId('permission-changes')).toContainText('Added');

  await page
    .getByTestId('permission-changes')
    .getByRole('button', { name: 'Reset to Role' })
    .click();
  await expect(page.getByTestId('permissions-summary')).toContainText('No changes for this person');
});

test('keeps its frames when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security/permissions`,
  );
  await expect(page.getByTestId('effective-permissions')).toBeVisible();
  await expect(page.getByTestId('permission-changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Permissions' })).toBeDisabled();
});
