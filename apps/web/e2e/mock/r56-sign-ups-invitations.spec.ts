import { expect, test } from '@playwright/test';

// R56, Clients Review Two N8-09 in mock mode as the Owner: Sign-ups > Invitations lists the
// clients with no portal login and their invitation's state; Invite, Resend and Revoke each ask
// first and change the row's state (the portal invitations mock keeps the API's rules).
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('N8-09: Invite, then Revoke, then Resend from Sign-ups > Invitations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app('/sign-ups'));
  await page.getByTestId('sign-ups-tab-INVITATIONS').click({ timeout: 60_000 });
  await expect(page).toHaveURL(/tab=invitations/);
  const tab = page.getByTestId('sign-ups-invitations');
  const rows = tab.getByTestId('invitation-row');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  // A client with no email can't be invited, and says why.
  await expect(rows.filter({ hasText: 'No email on file: add one' }).first()).toContainText(
    'Can’t invite',
  );

  // Invite the first client who can be: it asks first, then the row is Sent.
  const invite = tab.getByRole('button', { name: /^Invite / }).first();
  const label = (await invite.getAttribute('aria-label')) ?? '';
  const name = label.replace(/^Invite /, '');
  const row = rows.filter({ hasText: name });
  await invite.click();
  const ask = page.getByRole('dialog', { name: `Invite ${name}?` });
  await expect(ask).toContainText('It works for 7 days');
  await ask.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(tab.getByTestId('invitations-notice')).toContainText('Invitation sent to');
  await expect(row).toContainText('Sent');
  await expect(row.getByRole('button', { name: `Revoke ${name}` })).toBeVisible();

  // Revoke asks, then the row is Revoked with Resend.
  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  const revoke = page.getByRole('dialog', { name: `Revoke the invitation to ${name}?` });
  await revoke.getByRole('button', { name: 'Revoke Invitation' }).click();
  await expect(row).toContainText('Revoked');
  await row.getByRole('button', { name: `Resend ${name}` }).click();
  const resend = page.getByRole('dialog', { name: `Resend the invitation to ${name}?` });
  await expect(resend).toContainText('The earlier link stops working.');
  await resend.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(row).toContainText('Sent');

  // The status filter narrows the list.
  await tab.getByLabel('Invitation status').selectOption('NOT_INVITED');
  await expect(rows.filter({ hasText: name })).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
