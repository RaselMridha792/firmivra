import { expect, test } from '@playwright/test';

// Settings > Users & Roles (/settings/users), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('lists, filters and invites users', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  await expect(page).toHaveTitle('Users & roles');
  // The first visit compiles the page in dev.
  await expect(page.getByTestId('users-kpis')).toContainText('Pending Invitations', {
    timeout: 60_000,
  });
  const table = page.getByTestId('user-management');
  await expect(table).toContainText('Hana Kim');

  await expect(table.getByLabel('Company')).toHaveValue('');
  await table.getByLabel('Select all rows').check();
  await table.getByLabel('Select all rows').uncheck();

  // An invited user is "Pending", as in the design.
  await table.getByLabel('Status').selectOption('invited');
  await expect(table).toContainText('Sam Whitley');
  await expect(table).toContainText('Pending');
  await expect(table).not.toContainText('Hana Kim');
  await table.getByLabel('Status').selectOption('all');

  // The counters filter the table: Pending Invitations, then back to everyone.
  await page.getByRole('button', { name: 'Show pending invitations' }).click();
  await expect(table.getByLabel('Status')).toHaveValue('invited');
  await expect(table).not.toContainText('Hana Kim');
  await page.getByRole('button', { name: 'Show all users' }).click();
  await expect(table.getByLabel('Status')).toHaveValue('all');
  await expect(table).toContainText('Hana Kim');
  await table.getByLabel('Search users').fill('no such person');
  await expect(table).toContainText('No employees match your filters');
  await table.getByLabel('Search users').fill('');

  await page.getByRole('button', { name: 'Invite User' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite User' });
  await invite.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(invite.getByText('Enter their name.')).toBeVisible();
  await invite.getByLabel('Name *').fill('Nora Diaz');
  await invite.getByLabel('Work Email *').fill('nora.diaz@example.test');
  await invite.getByLabel('Role *').selectOption({ label: 'Bookkeeper' });
  await invite.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(page.getByTestId('users-result')).toHaveText('Invitation sent to Nora Diaz.');
});

test('signs a user out from the row menu and edits a role grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  const table = page.getByTestId('user-management');
  await table.getByRole('button', { name: 'Actions for Hana Kim' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out All Sessions' }).click();
  await page
    .getByRole('dialog', { name: 'Sign Out All Sessions' })
    .getByRole('button', { name: 'Sign Out All' })
    .click();
  await expect(page.getByTestId('users-result')).toContainText('signed out');

  // The Role select picks the grid; the module row you click shows in Permission Details.
  await page.getByTestId('role-permissions').getByLabel('Role').selectOption('BOOKKEEPER');
  await expect(page.getByTestId('role-permissions').getByLabel('Role')).toHaveValue('BOOKKEEPER');
  await page
    .getByTestId('module-permissions')
    .getByRole('rowheader', { name: 'Clients', exact: true })
    .click();
  await expect(page.getByTestId('permission-detail')).toContainText('Clients');
  await expect(page.getByTestId('permission-details')).toContainText('Changes to permissions');

  // A role template starts Create Custom Role from that role.
  await page.getByTestId('role-templates').getByRole('button', { name: 'Bookkeeper' }).click();
  await expect(page).toHaveURL(/\/settings\/users\/roles\/new\?from=BOOKKEEPER$/);
});

test('Reset User Passwords and Deactivate User find any user, whatever the table shows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  const table = page.getByTestId('user-management');
  // The table shows pending invitations only; the picker still lists every eligible user.
  await table.getByLabel('Status').selectOption('invited');
  await expect(table).not.toContainText('Hana Kim');

  const quick = page.getByTestId('users-quick-actions');
  await quick.getByRole('button', { name: 'Reset User Passwords' }).click();
  const pick = page.getByTestId('pick-user');
  await expect(pick.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(pick).not.toContainText('Victor Lane'); // deactivated: no password to reset
  await pick.getByLabel('Search users').fill('hana');
  await pick.getByRole('option', { name: /Hana Kim/ }).click();
  await pick.getByRole('button', { name: 'Continue' }).click();
  const reset = page.getByRole('dialog', { name: 'Reset Password' });
  await expect(reset).toContainText('Hana Kim (');
  await reset.getByRole('button', { name: 'Send Reset Link' }).click();
  await expect(page.getByTestId('users-result')).toContainText('reset link was emailed');

  // Deactivate: choose, then cancel at the confirmation; nothing changes.
  await quick.getByRole('button', { name: 'Deactivate User' }).click();
  await page.getByTestId('pick-user').getByLabel('Search users').fill('marcus');
  await page
    .getByTestId('pick-user')
    .getByRole('option', { name: /Marcus Bell/ })
    .click();
  await page.getByTestId('pick-user').getByRole('button', { name: 'Continue' }).click();
  const confirm = page.getByRole('dialog', { name: 'Deactivate Account' });
  await expect(confirm).toContainText('Their clients, tasks and history stay');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await table.getByLabel('Status').selectOption('active');
  await expect(table).toContainText('Marcus Bell');
});
