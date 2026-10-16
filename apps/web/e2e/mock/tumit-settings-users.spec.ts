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

  await table.getByLabel('Status').selectOption('invited');
  await expect(table).toContainText('Sam Whitley');
  await expect(table).not.toContainText('Hana Kim');
  await table.getByLabel('Status').selectOption('all');

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

  // Role Templates choose the grid's role.
  await page
    .getByRole('button', { name: /Bookkeeper/ })
    .first()
    .click();
  await expect(page.getByTestId('role-permissions').getByLabel('Role')).toHaveValue('BOOKKEEPER');
  await expect(page.getByTestId('permission-details')).toContainText('Changes to permissions');
});
