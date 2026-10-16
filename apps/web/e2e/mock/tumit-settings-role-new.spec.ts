import { expect, test } from '@playwright/test';

// Settings > Users & Roles > Create Custom Role (/settings/users/roles/new), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('checks the name, shows the starting grid and explains the missing API', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users/roles/new`);
  await expect(page).toHaveTitle('Create custom role');
  await expect(page.getByLabel('Start From *')).toHaveValue('STAFF', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Create Role' }).click();
  await expect(page.getByText('Enter a role name.')).toBeVisible();

  await page.getByLabel('Role Name *').fill('Payroll Specialist');
  await page.getByLabel('Start From *').selectOption('BOOKKEEPER');
  await expect(
    page.getByTestId('starting-permissions').getByRole('checkbox').first(),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Create Role' }).click();
  await expect(page.getByText('Custom roles are not available yet.')).toBeVisible();
  await expect(page.getByLabel('Role Name *')).toHaveValue('Payroll Specialist');
});
