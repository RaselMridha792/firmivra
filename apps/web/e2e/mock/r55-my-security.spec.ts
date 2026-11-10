import { expect, test } from '@playwright/test';

// R55, SM14 part B: My Profile's Security card. Any staff member signs out their own other
// sessions (this device stays) and changes their own password with the current one first. Mock
// mode: two sessions, this one and a phone; the mock's current password is "Current-Password-1".
// 1440 px. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('signs out the other sessions after asking, and changes the password (SM14 part B)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/profile`);
  const card = page.getByTestId('my-security');
  const sessions = card.getByRole('list', { name: 'Your sessions' });
  await expect(sessions.getByRole('listitem')).toHaveCount(2);
  await expect(sessions.getByText('This device')).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/team-security/my-security.png' });

  // Sign Out All Other Sessions asks first; this device stays.
  await card.getByRole('button', { name: 'Sign Out All Other Sessions' }).click();
  const ask = page.getByRole('dialog', { name: 'Sign out of your other sessions?' });
  await ask.getByRole('button', { name: 'Sign Out Other Sessions' }).click();
  await expect(card.getByTestId('my-security-result')).toHaveText('1 other session signed out.');
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await expect(card.getByRole('button', { name: 'Sign Out All Other Sessions' })).toBeDisabled();

  // Change Password: the current one first.
  await card.getByRole('button', { name: 'Change Password' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change Password' });
  await dialog.getByLabel('Current password').fill('Not-the-right-1');
  await dialog.getByLabel('New password', { exact: true }).fill('Brand-New-Passw0rd');
  await dialog.getByLabel('Confirm new password').fill('Brand-New-Passw0rd');
  await dialog.getByRole('button', { name: 'Change Password' }).click();
  await expect(dialog.getByText('Your current password is not right')).toBeVisible();
  await dialog.getByLabel('Current password').fill('Current-Password-1');
  await dialog.getByRole('button', { name: 'Change Password' }).click();
  await expect(card.getByTestId('my-security-result')).toHaveText('Your password was changed.');
});
