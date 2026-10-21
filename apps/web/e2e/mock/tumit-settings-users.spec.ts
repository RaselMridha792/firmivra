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
