import { expect, test } from '@playwright/test';

// Create Staff step 2 (Role & Permissions), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. Tax Preparer's defaults: Clients view, create and edit; Tax Returns view and
// create; no Settings. Morgan Avery owns the firm (every box). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/team/new/permissions`;

test('a role loads its defaults; presets clear, restore and copy the grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await expect(page).toHaveTitle('Create staff: Role & permissions');
  await expect(page.getByText('Choose a role to see its permissions here.')).toBeVisible();

  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page.getByText('Choose a role.')).toBeVisible();

  await page.getByLabel('Select a Role *').selectOption({ label: 'Tax Preparer' });
  await expect(page.getByTestId('role-description')).toContainText('Tax Preparer');
  const clientsEdit = page.getByRole('checkbox', { name: 'Clients: Edit' });
  await expect(clientsEdit).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Settings: View' })).not.toBeChecked();

  await page.getByRole('button', { name: 'Clear All Permissions' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByRole('checkbox', { name: 'Dashboard: View' })).not.toBeChecked();

  await page.getByRole('button', { name: 'Apply Default Permissions for This Role' }).click();
  await expect(clientsEdit).toBeChecked();

  // Copy from another member: their whole grid replaces the boxes.
  await page.getByRole('button', { name: 'Copy Permissions from Another Staff Member' }).click();
  const copy = page.getByRole('dialog');
  await copy.getByRole('button', { name: 'Copy Permissions' }).click();
  await expect(copy.getByText('Choose a staff member.')).toBeVisible();
  await copy.getByLabel('Staff member *').selectOption({ label: 'Morgan Avery, Owner / CEO' });
  await copy.getByRole('button', { name: 'Copy Permissions' }).click();
  await expect(copy).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'Settings: Manage' })).toBeChecked();
});

test('the draft carries the role and the changed grid between steps 1, 2 and 3', async ({
  page,
}) => {
  // The mock keeps drafts in the page's memory, so the steps are walked, not reloaded.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/new`);
  await page.getByLabel('First Name *').fill('Riley');
  await page.getByLabel('Last Name *').fill('Quinn');
  await page.getByLabel('Work Email *').fill('riley.quinn@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Bookkeeping' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Bookkeeper');
  await page.getByLabel('Role *').selectOption({ label: 'Bookkeeper' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });

  // Step 2 opens with step 1's role; a changed box survives Back and Next.
  await expect(page.getByLabel('Select a Role *')).toHaveValue('BOOKKEEPER');
  await page.getByRole('checkbox', { name: 'Settings: View' }).check();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/team\/new\?draft=/);
  await expect(page.getByLabel('First Name *')).toHaveValue('Riley');
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page.getByRole('checkbox', { name: 'Settings: View' })).toBeChecked();

  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  // Step 3 may compile on first use in dev, so the wait is longer.
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
});
