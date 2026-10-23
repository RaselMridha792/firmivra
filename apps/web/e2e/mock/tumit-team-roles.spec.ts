import { expect, test } from '@playwright/test';

// Staff Management > Roles & Permissions, in mock mode (playwright.mock.config.ts), signed in as
// the Owner. R42's roles mock: eight firm roles with code defaults (Tax Preparer: Clients view,
// create and edit; Tax Returns view and create). Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/roles`;

test('owner changes a role past its default, confirms, then puts the default back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Roles & permissions');
  await expect(page.getByTestId('page-title')).toHaveText('Roles & Permissions');
  const description = page.getByTestId('role-description');
  await expect(description).toContainText('Admin');

  // Role Templates choose a role; the select follows.
  await page.getByTestId('role-template').filter({ hasText: 'Tax Preparer' }).click();
  await expect(description).toContainText('Tax Preparer');
  await expect(page.getByLabel('Select a Role *')).toHaveValue('TAX_PREPARER');
  const editReturns = page.getByRole('checkbox', { name: 'Tax Returns: Edit' });
  await expect(page.getByRole('checkbox', { name: 'Clients: Edit' })).toBeChecked();
  await expect(editReturns).not.toBeChecked();

  // More than the default asks first.
  await editReturns.check();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Give Tax Preparer more than its default?');
  await confirm.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  await expect(description).toContainText('Customized');
  await expect(editReturns).toBeChecked();

  // Apply Default Permissions removes the firm's change.
  await page.getByRole('button', { name: 'Apply Default Permissions for This Role' }).click();
  await expect(description).not.toContainText('Customized');
  await expect(editReturns).not.toBeChecked();
});

test('View is needed for the rest, Clear All waits for Save, and Owner cannot change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByTestId('role-template').filter({ hasText: 'Tax Preparer' }).click();

  // Taking View away takes Create and Edit with it.
  await page.getByRole('checkbox', { name: 'Clients: View' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Clients: Edit' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('checkbox', { name: 'Clients: Edit' })).toBeChecked();

  await page.getByRole('button', { name: 'Clear All Permissions' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByRole('checkbox', { name: 'Dashboard: View' })).not.toBeChecked();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('checkbox', { name: 'Dashboard: View' })).toBeChecked();

  await page.getByTestId('role-template').filter({ hasText: 'Owner' }).click();
  await expect(page.getByText('The Owner role always has every permission')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Settings: Manage' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
});

test('Create Custom Role checks its fields, then Set Permissions creates it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Create Custom Role' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next: Set Permissions' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await expect(dialog.getByText('Choose the role it starts from.')).toBeVisible();
  await dialog.getByLabel('Role Name *').fill('Seasonal Preparer');
  await dialog.getByLabel('Start From *').selectOption({ label: 'Tax Preparer' });
  await dialog.getByRole('button', { name: 'Next: Set Permissions' }).click();
  const grid = page.getByTestId('set-permissions');
  await expect(grid.getByRole('checkbox', { name: 'Tax Returns: View' })).toBeChecked();
  await grid.getByRole('checkbox', { name: 'Tax Returns: Create' }).uncheck();
  await grid.getByRole('button', { name: 'Save Role' }).click();
  // The new role is chosen, with its own grid, and can be edited like any other.
  await expect(page.getByLabel('Select a Role *')).toHaveValue(/^custom:/);
  await expect(page.getByTestId('role-description')).toContainText('Seasonal Preparer');
  await expect(page.getByRole('checkbox', { name: 'Tax Returns: Create' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Tax Returns: Create' }).check();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Tax Returns: Create' })).toBeChecked();
});
