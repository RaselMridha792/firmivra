import { expect, type Page, test } from '@playwright/test';

// Intake Forms > Intake Form Settings (/intake-forms/settings) in mock mode
// (playwright.mock.config.ts, the intakeForms mock, as the Owner). Synthetic data only: the mock's
// default settings and its one recent change.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openSettings(page: Page) {
  await page.goto(app('/intake-forms/settings'));
  await expect(page).toHaveTitle('Intake form settings');
  await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeVisible({
    timeout: 60_000,
  });
}

test('shows the numbers, the six cards, the checklist and the side frames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSettings(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Intake Form Settings' })).toBeVisible();

  // The mock's defaults: 10 of the 14 switches on, reminders scheduled, no rules, e-sign on.
  await expect(page.getByTestId('kpi-active')).toContainText('10');
  await expect(page.getByTestId('kpi-active')).toContainText('Active Settings');
  await expect(page.getByTestId('kpi-reminders')).toContainText('On');
  await expect(page.getByTestId('kpi-rules')).toContainText('0');
  await expect(page.getByTestId('kpi-esign')).toContainText('Enabled');

  for (const name of [
    'General Settings',
    'Client Experience',
    'Notifications & Reminders',
    'Automation Rules',
    'Security & Compliance',
    'Branding',
  ])
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Default form expiration' })).toHaveValue('14');
  await expect(page.getByRole('combobox', { name: 'First reminder after' })).toHaveValue('3');
  await expect(page.getByRole('switch', { name: 'Enable encrypted file uploads' })).toBeDisabled();

  // Real checks, not ticks for every switch: no default owner yet, no automation rules.
  const checklist = page.getByTestId('settings-checklist');
  await expect(checklist).toContainText('Email notifications enabled (done)');
  await expect(checklist).toContainText('General settings configured (not done)');
  await expect(checklist).toContainText('Ready to use (not done)');
  await checklist.getByRole('button', { name: 'View All' }).click();
  await expect(checklist).toContainText('Choose the assigned owner for new forms.');

  await expect(page.getByTestId('recent-changes')).toContainText(
    'Updated form expiration to 14 days',
  );
  await expect(page.getByTestId('client-preview')).toContainText('Sample Intake Form');
  await expect(
    page.getByTestId('settings-pro-tip').getByRole('link', { name: /Go to Automations/ }),
  ).toHaveAttribute('href', '/automations');
  await expect(
    page.getByTestId('settings-quick-actions').getByRole('link', { name: 'Manage Templates' }),
  ).toHaveAttribute('href', '/intake-forms/templates');

  // A category with no card says what covers it.
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(page.getByTestId('section-note')).toContainText('Open Integrations');
});

test('a switch saves, and Recent Changes shows it', async ({ page }) => {
  await openSettings(page);
  const task = page.getByRole('switch', { name: 'Auto-create follow-up task' });
  await expect(task).toHaveAttribute('aria-checked', 'false');
  await task.click();
  await expect(task).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('unsaved')).toBeVisible();

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  await expect(task).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('kpi-active')).toContainText('11');
  await expect(page.getByTestId('recent-changes')).toContainText('Intake settings updated');
});

test('a field error shows next to its field', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('switch', { name: 'Redirect after completion' }).click();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Add the address to send clients to')).toBeVisible();
  const url = page.getByRole('textbox', { name: 'Redirect URL (optional)' });
  await expect(url).toHaveAttribute('aria-invalid', 'true');

  await url.fill('https://example.test/thank-you');
  await expect(page.getByText('Add the address to send clients to')).toBeHidden();
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
});

test('Reset Defaults asks first', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Reset Defaults' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset to the defaults?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('recent-changes')).not.toContainText('Settings reset');

  await page.getByRole('switch', { name: 'Show progress bar' }).click();
  await page.getByRole('button', { name: 'Reset Defaults' }).click();
  await dialog.getByRole('button', { name: 'Reset Defaults' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('The intake settings were reset to the defaults.')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show progress bar' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('recent-changes')).toContainText('Settings reset to defaults');
});

test('Test Reminder Email shows its toast', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Test Reminder Email' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'A test reminder email was sent to you.' }),
  ).toBeVisible();
});

test('Preview Client View shows the sample form without sending', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Preview Client View' }).click();
  const dialog = page.getByRole('dialog', { name: 'Client Preview' });
  await expect(dialog.getByTestId('client-preview-full')).toContainText('Sample Intake Form');
  await expect(dialog.getByTestId('client-preview-full')).toContainText('Save and finish later');
  await dialog.getByRole('button', { name: 'Close Preview' }).click();
  await expect(dialog).toBeHidden();
});

test('no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openSettings(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
