import { expect, test } from '@playwright/test';

// Staff Management > Staff Settings (/team/settings), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the staff defaults and links to the pages that change them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/settings`);
  await expect(page).toHaveTitle('Staff settings');
  await expect(page.getByTestId('settings-security')).toContainText('Always required');
  await expect(page.getByTestId('settings-roles')).toContainText('Tax Preparer');
  await expect(page.getByTestId('settings-directory')).toContainText('Pending invitations');
  await expect(page.getByTestId('settings-groups')).toContainText('Departments');
  await expect(page.getByTestId('settings-offices')).toContainText('Main Office');
  await page.getByRole('link', { name: 'Manage Roles & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/roles$/, { timeout: 30_000 });
});
