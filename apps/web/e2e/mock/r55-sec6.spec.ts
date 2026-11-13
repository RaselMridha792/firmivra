import { expect, test } from '@playwright/test';

// R55, SM14 part C (SEC-6): the Owner makes an Admin a security administrator, after a confirm, on
// the member's Access & Security page. Mock mode, signed in as the Owner (Morgan Avery); Priya
// Ramos is an Admin. 1440 px. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const PRIYA = '0199c0a0-0a00-7000-8000-000000000002';

test('the Owner makes an Admin a security administrator, after a confirm (SEC-6)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${PRIYA}/security`);
  const card = page.getByTestId('security-admin');
  await expect(card.getByTestId('security-admin-state')).toHaveText('No');
  await card.getByRole('button', { name: 'Make Security Administrator' }).click();
  await page
    .getByRole('dialog', { name: 'Make security administrator?' })
    .getByRole('button', { name: 'Confirm' })
    .click();
  await expect(card.getByTestId('security-admin-state')).toHaveText('Yes');
  await expect(card.getByRole('button', { name: 'Remove Security Administrator' })).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/team-security/security-admin.png' });
});

test('Settings > Security: the Owner records an approved exception, and the card says sign-in still asks for a code', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/security`);
  const card = page.getByTestId('mfa-policy');
  const control = card.getByTestId('mfa-policy-control');
  await expect(control).toContainText('Required');
  await expect(control.getByTestId('mfa-enforced')).toHaveText(
    "Firmivra's sign-in still asks every staff login for a code.",
  );
  await expect(card).not.toContainText('There is no setting to change it yet');

  await control.getByRole('button', { name: 'Change Requirement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change the two-factor requirement' });
  await dialog.getByLabel('Not required (an approved exception)').check();
  const save = dialog.getByRole('button', { name: 'Save Requirement' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Current password').fill('Wrong-Password-1');
  await dialog.getByLabel("I confirm this change to the firm's security policy.").check();
  await save.click();
  await expect(dialog).toContainText('Write the approved exception: why, and who approved it');
  await dialog
    .getByLabel('Approved exception (why, and who approved it)')
    .fill('Fake exception for the kiosk login, approved by the fake Owner');
  await save.click();
  await expect(dialog).toContainText('Your current password is not right');
  await dialog.getByLabel('Current password').fill('Current-Password-1');
  await save.click();
  await expect(dialog).toHaveCount(0);

  await expect(control).toContainText('Approved exception');
  await expect(control.getByTestId('mfa-exception')).toContainText(
    'Fake exception for the kiosk login',
  );
  await expect(control.getByTestId('mfa-enforced')).toHaveText(
    "Firmivra's sign-in still asks every staff login for a code, whatever this records: turning it off only records the exception.",
  );
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/settings-security/mfa-policy.png' });
});
