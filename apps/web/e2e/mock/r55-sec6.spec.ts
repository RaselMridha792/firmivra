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
