import { expect, type Page, test } from '@playwright/test';

// Edit Staff Account (/team/[id]), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The mock's sixth member is Hana Kim. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}`);
  await expect(page.getByLabel('First Name *')).toHaveValue('Hana');
}

test('fills the member and saves changes into the same record', async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle('Edit staff account');
  await expect(page.getByTestId('page-title')).toHaveText('Edit Staff Account');
  await expect(page.getByLabel('Work Email *')).toHaveValue('hana.kim@lvp.test');
  await expect(page.getByLabel('Job Title *')).toHaveValue('Payroll & Accounting Specialist');
  await expect(page.getByTestId('staff-profile')).toContainText('Active');
  await expect(page.getByTestId('access-summary')).toContainText('View');
  await expect(page.getByTestId('recent-activity')).toContainText('Logged in');
  await expect(page.getByTestId('staff-notes')).toContainText('Handles payroll processing');
  // Two-factor sign-in is always on for staff.
  await expect(page.getByLabel('Require two-factor authentication (2FA)')).toBeDisabled();

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('edit-saved')).toHaveText('Nothing has changed yet.');

  await page.getByLabel('Job Title *').fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter or choose a job title.')).toBeVisible();

  await page.getByLabel('Job Title *').fill('Senior Payroll Specialist');
  await page.getByLabel('Phone Number').fill('(555) 010-0999');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('edit-saved')).toHaveText('Changes saved for Hana Kim.');
  await expect(page.getByTestId('staff-profile')).toContainText('Senior Payroll Specialist');
  await expect(page.getByLabel('Phone Number')).toHaveValue('(555) 010-0999');
});

test('quick actions ask first; Delete offers Deactivate and keeps the history', async ({
  page,
}) => {
  await open(page);
  const actions = page.getByTestId('quick-actions');
  // Resend Invite is only for someone who has not joined.
  await expect(actions.getByRole('button', { name: 'Resend Invite' })).toBeDisabled();

  await actions.getByRole('button', { name: 'Sign Out All Sessions' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign Out All Sessions' });
  await dialog.getByLabel('Reason (optional)').fill('Lost laptop');
  await dialog.getByRole('button', { name: 'Sign Out All' }).click();
  await expect(page.getByTestId('action-result')).toHaveText(
    /sessions? signed out|no open sessions/,
  );

  await actions.getByRole('button', { name: 'Delete Account' }).click();
  const remove = page.getByRole('dialog', { name: 'Delete Account' });
  await expect(remove).toContainText('never deleted');
  await remove.getByRole('button', { name: 'Deactivate Instead' }).click();
  await expect(page.getByTestId('action-result')).toContainText('Their history is kept.');
  await expect(page.getByTestId('staff-profile')).toContainText('Deactivated');
  await expect(page.getByRole('button', { name: 'Deactivate Account' }).last()).toBeDisabled();
});

test('edits the note', async ({ page }) => {
  await open(page);
  await page.getByTestId('staff-notes').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Notes' });
  await dialog.getByLabel('Account Notes').fill('Covers payroll on Fridays.');
  await expect(dialog).toContainText('26/500');
  await dialog.getByRole('button', { name: 'Save Notes' }).click();
  await expect(page.getByTestId('staff-notes')).toContainText('Covers payroll on Fridays.');
});

test('keeps every frame when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999`);
  await expect(page.getByText('This staff member was not found.').first()).toBeVisible();
  for (const heading of ['1. Account Information', '4. Additional Details', 'Quick Actions']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
});

test('shows chosen service areas as removable chips', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Service Area\(s\)/ }).click();
  const first = page.getByRole('group', { name: 'Service Area(s)' }).getByRole('checkbox').first();
  const label = (await first.locator('xpath=..').innerText()).trim();
  await first.check();
  const remove = page.getByRole('button', { name: `Remove ${label}` });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
});
