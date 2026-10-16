import { expect, type Page, test } from '@playwright/test';

// Create Staff step 3 (Access & Security), in mock mode (playwright.mock.config.ts), signed in
// as the Owner. The mock keeps drafts in the page's memory, so the test walks from step 1.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

async function toStep3(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/new`);
  await page.getByLabel('First Name *').fill('Sam');
  await page.getByLabel('Last Name *').fill('Park');
  await page.getByLabel('Work Email *').fill('sam.park@example.test');
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: 'Tax' }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill('Tax Preparer');
  await page.getByLabel('Role *').selectOption({ label: 'Tax Preparer' });
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
}

test('checks the restrictions and methods, then opens step 4', async ({ page }) => {
  await toStep3(page);
  await expect(page).toHaveTitle('Create staff: Access & security');
  await expect(page.getByTestId('account-preview')).toContainText('Sam Park');
  // No password is ever set; two-factor sign-in is always on.
  await expect(page.getByLabel('Set custom password')).toBeDisabled();
  await expect(page.getByLabel('Require two-factor authentication (2FA)')).toBeDisabled();

  await page.getByLabel('Specific IP Addresses Only').check();
  for (const method of [
    'Authenticator App (e.g., Google Authenticator)',
    'SMS (Text Message)',
    'Email Verification',
    'Backup Codes (recommended)',
  ]) {
    await page.getByRole('checkbox', { name: method, exact: true }).uncheck();
  }
  await page.getByLabel('Recovery Email (Optional)').fill('not-an-email');
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page.getByText('Use IP addresses or networks like 203.0.113.0/24')).toBeVisible();
  await expect(page.getByText('Choose at least one sign-in method.')).toBeVisible();

  await page.getByLabel('Allowed IP addresses or networks *').fill('not-an-ip');
  await page.getByRole('checkbox', { name: /Authenticator App/ }).check();
  await page.getByLabel('Recovery Email (Optional)').fill('');
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page.getByText('Use IP addresses or networks like 203.0.113.0/24')).toBeVisible();

  await page.getByLabel('Allowed IP addresses or networks *').fill('203.0.113.0/24');
  await page.getByRole('button', { name: 'Next: Additional Details' }).click();
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
});

test('the draft keeps step 3 through Back and Next', async ({ page }) => {
  await toStep3(page);
  await page.getByLabel('Set automatic logout after inactivity').check();
  await page.getByLabel('Inactivity time').selectOption({ label: '1 hour' });
  await page.getByLabel('Account lockouts').uncheck();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/);
  await page.getByRole('button', { name: 'Next: Access & Security' }).click();
  await expect(page.getByLabel('Inactivity time')).toHaveValue('60');
  await expect(page.getByLabel('Account lockouts')).not.toBeChecked();
});
