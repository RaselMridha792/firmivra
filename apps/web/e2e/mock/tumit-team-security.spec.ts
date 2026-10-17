import { expect, type Page, test } from '@playwright/test';

// Staff Account Access & Security, Account Overview (/team/[id]/security), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security`);
  await expect(page.getByTestId('security-member')).toContainText('Hana Kim');
}

test('shows the account, its settings, sessions and sign-ins', async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle('Staff security: Account overview');
  await expect(page.getByTestId('page-title')).toHaveText('Staff Account Access & Security');
  await expect(page.getByRole('link', { name: 'Account Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('security-member')).toContainText('EMP006');
  await expect(page.getByTestId('account-status')).toContainText('Active');
  await expect(page.getByTestId('security-settings')).toContainText('Enabled');
  await expect(page.getByTestId('security-settings')).toContainText('30 minutes');
  await expect(page.getByTestId('active-sessions')).toContainText('MacBook Pro / Chrome');
  await expect(page.getByTestId('login-history')).toContainText('Failed');
  await expect(page.getByTestId('account-notes').getByLabel('Account note')).toHaveValue(
    /Handles payroll processing/,
  );
  await expect(page.getByRole('link', { name: 'Login History' })).toHaveAttribute(
    'href',
    `/team/${HANA}/security/history`,
  );
});

test('signs out one session, then locks and unlocks with a reason', async ({ page }) => {
  await open(page);
  const sessions = page.getByTestId('active-sessions');
  await sessions.getByRole('button', { name: 'Actions for iPhone / Safari' }).click();
  await page.getByRole('menuitem', { name: 'Sign out this session' }).click();
  await page
    .getByRole('dialog', { name: 'Sign Out Session' })
    .getByRole('button', { name: 'Sign Out' })
    .click();
  await expect(page.getByTestId('sessions-result')).toHaveText('iPhone / Safari was signed out.');
  await expect(sessions.getByRole('cell', { name: 'iPhone / Safari' })).toHaveCount(0);

  const quick = page.getByTestId('quick-buttons');
  await quick.getByRole('button', { name: 'Lock Account' }).click();
  const lock = page.getByRole('dialog', { name: 'Lock Account' });
  await lock.getByRole('button', { name: 'Lock Account' }).click();
  await expect(lock.getByText('Say why the account is locked.')).toBeVisible();
  await lock.getByLabel('Reason *').fill('Suspicious sign-in');
  await lock.getByRole('button', { name: 'Lock Account' }).click();
  await expect(page.getByTestId('quick-buttons-result')).toContainText('account is locked');
  await expect(page.getByTestId('account-status')).toContainText('Suspicious sign-in');

  await quick.getByRole('button', { name: 'Unlock Account' }).click();
  await page
    .getByRole('dialog', { name: 'Unlock Account' })
    .getByRole('button', { name: 'Unlock Account' })
    .click();
  await expect(page.getByTestId('quick-buttons-result')).toContainText('is unlocked');
  await expect(page.getByTestId('account-status')).toContainText('Active');
});

test('saves the account note', async ({ page }) => {
  await open(page);
  const notes = page.getByTestId('account-notes');
  await notes.getByLabel('Account note').fill('Covers payroll on Fridays.');
  await expect(notes).toContainText('26/500');
  await notes.getByRole('button', { name: 'Save Note' }).click();
  await expect(notes.getByText('Note saved.')).toBeVisible();
  await expect(notes.getByLabel('Account note')).toHaveValue('Covers payroll on Fridays.');
});

test('keeps every frame when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security`,
  );
  await expect(page.getByText('This staff member was not found.').first()).toBeVisible();
  for (const card of ['account-status', 'security-settings', 'active-sessions', 'login-history']) {
    await expect(page.getByTestId(card)).toBeVisible();
  }
  await expect(
    page.getByTestId('quick-buttons').getByRole('button', { name: 'Reset Password' }),
  ).toBeDisabled();
});
