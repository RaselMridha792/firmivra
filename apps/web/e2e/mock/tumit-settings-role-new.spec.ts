import { expect, test } from '@playwright/test';

// Settings > Users & Roles > Create Custom Role (/settings/users/roles/new), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('checks the name, then Set Permissions saves the role with its grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users/roles/new`);
  await expect(page).toHaveTitle('Create custom role');
  await expect(page.getByLabel('Start From *')).toHaveValue('STAFF', { timeout: 60_000 });
  const next = page.getByRole('button', { name: 'Next: Set Permissions' });
  await next.click();
  await expect(page.getByText('Enter a role name.')).toBeVisible();
  // A built-in role's name is taken.
  await page.getByLabel('Role Name *').fill('bookkeeper');
  await next.click();
  await expect(page.getByText('A role with this name already exists.')).toBeVisible();

  await page.getByLabel('Role Name *').fill('Payroll Specialist');
  await page.getByLabel('Start From *').selectOption('BOOKKEEPER');
  await expect(
    page.getByTestId('starting-permissions').getByRole('checkbox').first(),
  ).toBeDisabled();
  await next.click();
  const dialog = page.getByTestId('set-permissions');
  await expect(
    page.getByRole('dialog', { name: 'Set Permissions: Payroll Specialist' }),
  ).toBeVisible();
  // The template's grid is ticked; Back keeps what was typed and saves nothing.
  await expect(dialog.getByRole('checkbox', { name: 'Clients: View' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Role Name *')).toHaveValue('Payroll Specialist');
  await next.click();
  // Leads is more than a Bookkeeper has: Save asks first.
  await dialog.getByRole('checkbox', { name: 'Leads / Prospects: View' }).check();
  await dialog.getByRole('button', { name: 'Save Role' }).click();
  await expect(dialog).toContainText('more than Bookkeeper has in this firm');
  await dialog.getByRole('button', { name: 'Save Anyway' }).click();

  // Users & Roles shows it: Role Permissions, the Roles count, the role filter.
  await expect(page).toHaveURL(/\/settings\/users\?role=custom/);
  const panel = page.getByTestId('role-permissions');
  await expect(panel.getByLabel('Role')).toHaveValue(/^custom:/);
  await expect(panel.getByTestId('custom-role-info')).toContainText('based on Bookkeeper');
  await expect(page.getByRole('checkbox', { name: 'Leads / Prospects: View' })).toBeChecked();
  await expect(page.getByText('1 custom role', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('user-management').getByLabel('Role').getByRole('option', {
      name: 'Payroll Specialist (custom)',
    }),
  ).toHaveCount(1);
});

test('starts from the template chosen on Users & Roles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users/roles/new?from=TAX_PREPARER`);
  await expect(page.getByLabel('Start From *')).toHaveValue('TAX_PREPARER', { timeout: 60_000 });
  const templates = page.getByTestId('role-templates');
  await expect(templates.getByRole('button', { name: 'Tax Preparer' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await templates.getByRole('button', { name: 'Client Support' }).click();
  await expect(page.getByLabel('Start From *')).toHaveValue('CLIENT_SUPPORT');
  // The Owner role is never a starting point.
  await page.goto(`http://app.localhost:${port}/settings/users/roles/new?from=OWNER`);
  await expect(page.getByLabel('Start From *')).toHaveValue('STAFF', { timeout: 60_000 });
});
