import { expect, test } from '@playwright/test';

// Octavia's SM3 (review of Oct 21 to 22): Staff Settings > New Accounts & Security opened Create
// Staff's step 3; it now opens the company-wide defaults for new accounts, which explain who they
// affect and ask before saving, and step 3 starts from them. Mock mode (playwright.mock.config.ts)
// as the Owner; the mock keeps its data in the page, so the test moves by links. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('saves the new account defaults after confirming, and Create Staff starts from them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/settings'));
  const card = page.getByTestId('settings-security');
  await expect(card).toContainText('Always required');
  await expect(card).toContainText('Off');
  await card.getByRole('link', { name: 'Manage New Account Security' }).click();
  await expect(page).toHaveURL(/\/team\/settings\/security$/, { timeout: 30_000 });
  await expect(page).toHaveTitle('New account security');
  await expect(
    page.getByText('11 existing staff accounts keep their own settings').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

  // Discard puts the saved values back.
  await page.getByLabel('Restrict login to specific devices').check();
  await page.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByLabel('Restrict login to specific devices')).not.toBeChecked();

  // A list goes with its access choice.
  await page.getByLabel('Specific Countries/Regions Only').check();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Use two-letter country codes like US, CA')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByLabel('Allowed countries *').fill('us, ca');
  await page.getByLabel('Set automatic logout after inactivity').check();
  await page.getByLabel('Inactivity time').selectOption({ label: '1 hour' });
  await page.getByLabel('Successful logins (new device)').uncheck();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save the new account defaults?' });
  await expect(dialog).toContainText('11 existing staff accounts keep their own settings');
  await dialog.getByRole('button', { name: 'Save Defaults' }).click();
  await expect(page.getByTestId('defaults-saved')).toBeVisible();
  await expect(page.getByText('by Morgan Avery')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Staff Settings' }).click();
  await expect(page.getByTestId('settings-security')).toContainText('After 1 hour');
  await page.getByRole('link', { name: 'Back to Staff Management' }).click();
  await page.getByRole('link', { name: 'Add Staff' }).first().click();
  await page.getByLabel('First Name *').fill('Ada');
  await page.getByLabel('Last Name *').fill('Moss');
  await page.getByLabel('Work Email *').fill('ada.moss@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await expect(page.getByLabel('Specific Countries/Regions Only')).toBeChecked();
  await expect(page.getByLabel('Allowed countries *')).toHaveValue('US, CA');
  await expect(page.getByLabel('Inactivity time')).toHaveValue('60');
  await expect(page.getByLabel('Successful logins (new device)')).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Email Verification' })).not.toBeChecked();
});
