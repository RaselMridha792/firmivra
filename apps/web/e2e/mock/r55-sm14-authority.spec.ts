import { expect, test } from '@playwright/test';

// R55, SM14: the account authority rules on screen, from the member detail's `authority`. Mock
// mode, signed in as the Owner, Morgan Avery, who is the firm's Original Owner (its first Owner).
// Priya Ramos is an Admin. 1440 px. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const member = (n: number) => `0199c0a0-0a00-7000-8000-${String(n).padStart(12, '0')}`;
const MORGAN = member(1);
const PRIYA = member(2);

test('the Original Owner can give the Owner role on Edit Staff (SM14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${PRIYA}`);
  const role = page.getByLabel('Role *');
  await expect(role).toBeEnabled();
  await expect(role.locator('option', { hasText: /^Owner$/ })).toHaveCount(1);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/team-security/edit-owner-role.png' });
});

test('the Original Owner is marked, and their own account has no actions (SM14)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${MORGAN}/security`);
  await expect(page.getByTestId('original-owner').first()).toHaveText('Original Owner');
  await expect(page.getByText("the firm's Original Owner's: nobody else changes it")).toBeVisible();
  const buttons = page.getByTestId('quick-buttons');
  await expect(buttons.getByRole('button', { name: 'Reset MFA' })).toBeDisabled();
  await expect(buttons.getByRole('button', { name: 'Lock Account' })).toBeDisabled();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/team-security/original-owner.png' });
});
