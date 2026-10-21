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
  // An existing staff record is invited (no second record): pick it, check the role, send.
  const invite = page.getByRole('dialog', { name: 'Invite User' });
  await expect(invite.getByRole('button', { name: 'Send Invitation' })).toBeDisabled();
  await invite.getByLabel('Search employees').fill('whit');
  await invite.getByRole('option', { name: /Sam Whitley/ }).click();
  await expect(invite.getByLabel('Role *')).toHaveValue('TAX_PREPARER');
  await invite.getByLabel('Role *').selectOption({ label: 'Bookkeeper' });
  await invite.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(page.getByTestId('users-result')).toContainText('Invitation sent to Sam Whitley');
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

test('Unlock and Reactivate from the row: review who it is, then confirm', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  const table = page.getByTestId('user-management');

  await table.getByLabel('Status').selectOption('locked');
  await table.getByRole('button', { name: 'Actions for Iris Novak' }).click();
  await page.getByRole('menuitem', { name: 'Unlock Account' }).click();
  const unlock = page.getByTestId('unlock-user');
  await expect(unlock).toContainText('Saved role');
  await expect(unlock).toContainText('Read Only');
  await expect(unlock).toContainText('does not reset a password');
  await unlock.getByRole('button', { name: 'Unlock Account' }).click();
  await expect(page.getByTestId('users-result')).toHaveText('Iris Novak’s account is unlocked.');
  await table.getByLabel('Status').selectOption('active');
  await expect(table).toContainText('Iris Novak');

  await table.getByLabel('Status').selectOption('inactive');
  await table.getByRole('button', { name: 'Actions for Victor Lane' }).click();
  await page.getByRole('menuitem', { name: 'Reactivate User' }).click();
  const reactivate = page.getByTestId('reactivate-user');
  await expect(reactivate).toContainText('Individual overrides');
  await reactivate.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByTestId('users-result')).toContainText('Victor Lane');
  // No longer inactive (the success line above the table names him; the rows do not).
  await expect(table.getByRole('row', { name: /Victor Lane/ })).toHaveCount(0);
});

test('Change Role: one person, with the new role previewed and their overrides kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  const table = page.getByTestId('user-management');
  await table.getByRole('button', { name: 'Actions for Hana Kim' }).click();
  await page.getByRole('menuitem', { name: 'Change Role' }).click();
  const dialog = page.getByTestId('change-role');
  await expect(dialog).toContainText('Current role');
  await expect(dialog).toContainText('Staff');
  await expect(dialog.getByRole('button', { name: 'Change Role' })).toBeDisabled();
  await dialog.getByLabel('New role *').selectOption({ label: 'Bookkeeper' });
  await expect(dialog).toContainText('What Bookkeeper can do in this firm');
  await expect(dialog).toContainText('Bookkeeping');
  await expect(dialog).toContainText('Individual overrides');
  await dialog.getByRole('button', { name: 'Change Role' }).click();
  await expect(page.getByTestId('users-result')).toHaveText(
    'Hana Kim is now Bookkeeper (was Staff).',
  );
  await table.getByLabel('Search users').fill('hana');
  await expect(table.getByRole('row', { name: /Hana Kim/ })).toContainText('Bookkeeper');
});

test('Custom roles: give one with Change Role, filter by it, and archive only when unused', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users/roles/new?from=STAFF`);
  await page.getByLabel('Role Name *').fill('Front Desk');
  await page.getByRole('button', { name: 'Next: Set Permissions' }).click();
  await page.getByTestId('set-permissions').getByRole('button', { name: 'Save Role' }).click();
  await expect(page).toHaveURL(/\/settings\/users\?role=custom/);

  const table = page.getByTestId('user-management');
  await table.getByRole('button', { name: /Actions for Hana Kim/ }).click();
  await page.getByRole('menuitem', { name: 'Change Role' }).click();
  const change = page.getByTestId('change-role');
  await change.getByLabel('New role *').selectOption({ label: 'Front Desk (custom)' });
  await expect(change).toContainText('What Front Desk can do in this firm');
  await change.getByRole('button', { name: 'Change Role' }).click();
  await expect(page.getByTestId('users-result')).toHaveText(
    'Hana Kim is now Front Desk (was Staff).',
  );
  await expect(table.getByRole('row', { name: /Hana Kim/ })).toContainText('Front Desk');
  await table.getByLabel('Role').selectOption({ label: 'Front Desk (custom)' });
  await expect(table.getByRole('row')).toHaveCount(2);

  // Someone has it: Archive says so; once nobody does, it goes.
  const panel = page.getByTestId('role-permissions');
  await panel.getByRole('button', { name: 'Archive Role' }).click();
  const archive = page.getByTestId('archive-role');
  await archive.getByRole('button', { name: 'Archive Role' }).click();
  await expect(archive.getByRole('alert')).toContainText('People still have this role');
  await archive.getByRole('button', { name: 'Cancel' }).click();
  await table.getByLabel('Role').selectOption('');
  await table.getByRole('button', { name: /Actions for Hana Kim/ }).click();
  await page.getByRole('menuitem', { name: 'Change Role' }).click();
  await change.getByLabel('New role *').selectOption({ label: 'Staff' });
  await change.getByRole('button', { name: 'Change Role' }).click();
  await expect(page.getByTestId('users-result')).toHaveText(
    'Hana Kim is now Staff (was Front Desk).',
  );
  await panel.getByLabel('Role').selectOption({ label: 'Front Desk (custom)' });
  await panel.getByRole('button', { name: 'Archive Role' }).click();
  await archive.getByRole('button', { name: 'Archive Role' }).click();
  await expect(page.getByTestId('users-result')).toHaveText('Front Desk archived.');
  await expect(panel.getByLabel('Role').getByRole('option', { name: /Front Desk/ })).toHaveCount(0);
});

test('Individual Permissions: Inherit, Allow or Deny per permission, and Reset to Inherit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/users`);
  const table = page.getByTestId('user-management');
  const open = async () => {
    await table.getByRole('button', { name: 'Actions for Hana Kim' }).click();
    await page.getByRole('menuitem', { name: 'Individual Permissions' }).click();
    return page.getByTestId('individual-permissions');
  };
  let dialog = await open();
  await expect(dialog).toContainText('Inherit follows the role');
  await dialog
    .getByRole('list', { name: 'Modules' })
    .getByRole('button', { name: 'Reports' })
    .click();
  const cells = dialog.getByTestId('override-cells');
  await expect(cells).toContainText('Reports');
  await expect(dialog.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await cells.getByRole('group', { name: 'Reports View' }).getByText('Allow').click();
  await cells.getByRole('group', { name: 'Reports Export' }).getByText('Allow').click();
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  // More than the Staff role has: it asks first.
  await expect(dialog).toContainText('more than the Staff role has');
  await dialog.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(page.getByTestId('users-result')).toContainText('Hana Kim’s permissions are saved');

  dialog = await open();
  await expect(dialog.getByRole('list', { name: 'Modules' })).toContainText('Reports2');
  await dialog.getByRole('button', { name: 'Reset all to Inherit' }).click();
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('users-result')).toContainText('Hana Kim’s permissions are saved');
  dialog = await open();
  await expect(dialog.getByRole('button', { name: 'Reset all to Inherit' })).toBeDisabled();
});
