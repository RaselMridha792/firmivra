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
  await expect(page.getByRole('combobox', { name: 'First reminder' })).toHaveValue('4320');
  // Octavia's I11: encryption is a label, not a switch.
  await expect(page.getByText('Encrypted file uploads', { exact: true })).toBeVisible();
  await expect(page.getByText('Always on', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: /encrypted/i })).toHaveCount(0);

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

test('Test Reminder Email says where it went, and that nothing changed', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Test Reminder Email' }).click();
  await expect(
    page.getByRole('status').filter({
      hasText: /A test reminder email was sent to \S+@\S+\. No client was contacted/,
    }),
  ).toBeVisible();
  await expect(page.getByText('not available yet')).toHaveCount(0);
});

// Octavia's review of Oct 20 (I4): each overview Edit opens its own editing panel.
test('each Edit opens its category’s panel, and Branding opens Settings', async ({ page }) => {
  await openSettings(page);
  for (const [edit, title] of [
    ['Edit General Settings', 'Edit General Settings'],
    ['Edit Client Experience', 'Edit Client Experience'],
    ['Edit Notifications & Reminders', 'Edit Notifications & Reminders'],
    ['Edit Automation Rules', 'Edit Automation Rules'],
    ['Edit Security & Compliance', 'Edit Security & Compliance'],
  ] as const) {
    await page.getByRole('button', { name: edit, exact: true }).click();
    const panel = page.getByRole('dialog', { name: title });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toBeHidden();
  }
  await expect(page.getByRole('link', { name: 'Edit branding in Settings' })).toHaveAttribute(
    'href',
    '/settings/branding',
  );
});

test('a panel’s Cancel puts its changes back; Save Changes saves and closes it', async ({
  page,
}) => {
  await openSettings(page);
  const card = page.getByRole('switch', { name: 'Notify assigned staff member' });
  await expect(card).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: 'Edit Notifications & Reminders', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Edit Notifications & Reminders' });
  await panel.getByRole('switch', { name: 'Notify assigned staff member' }).click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeHidden();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('unsaved')).toBeHidden();

  await page.getByRole('button', { name: 'Edit Notifications & Reminders', exact: true }).click();
  await panel.getByRole('switch', { name: 'Notify assigned staff member' }).click();
  await panel.getByRole('button', { name: 'Save Changes' }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(card).toHaveAttribute('aria-checked', 'false');
});

// Octavia's review of Oct 20 (I8, I9): reminders count from sending, in minutes, hours and days, and
// the final one follows the first; the expiration alert offers 30 minutes and her hours (42, not
// 48), and No alert.
const MINUTES = ['5 minutes', '10 minutes', '15 minutes', '30 minutes'];
const HOURS = ['1 hour', '2 hours', '3 hours', '6 hours', '12 hours'];
const DAYS = ['1 day', '2 days', '3 days', '5 days', '7 days', '10 days', '14 days', '21 days'];
const after = (times: string[]) => times.map((t) => `${t} after sending`);

test('reminders count from sending, the final follows the first, and No reminders saves', async ({
  page,
}) => {
  await openSettings(page);
  const first = page.getByRole('combobox', { name: 'First reminder' });
  const final = page.getByRole('combobox', { name: 'Final reminder' });
  const alert = page.getByRole('combobox', { name: 'Expiration alert' });
  await expect(first.locator('option')).toHaveText([
    'No reminders',
    ...after([...MINUTES, ...HOURS, ...DAYS]),
  ]);
  await expect(final.locator('option')).toHaveText(
    after(['5 days', '7 days', '10 days', '14 days', '21 days', '30 days']),
  );
  await expect(alert.locator('option')).toHaveText([
    'No alert',
    ...['30 minutes', '1 hour', '2 hours', '3 hours', '5 hours', '6 hours', '10 hours']
      .concat(['12 hours', '24 hours', '42 hours', '72 hours'])
      .map((t) => `${t} before expiry`),
  ]);

  // A later first reminder moves the final one after it.
  await first.selectOption('14400');
  await expect(final).toHaveValue('20160');
  await expect(final.locator('option')).toHaveText(after(['14 days', '21 days', '30 days']));

  // No reminders turns both off, and saves so.
  await first.selectOption('');
  await expect(final).toBeDisabled();
  await expect(final).toHaveValue('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(first).toHaveValue('');
  await expect(final).toBeDisabled();
});

test('No alert and an alert 30 minutes before expiry save (I9)', async ({ page }) => {
  await openSettings(page);
  const alert = page.getByRole('combobox', { name: 'Expiration alert' });
  await alert.selectOption({ label: 'No alert' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(alert).toHaveValue('');
  await alert.selectOption({ label: '30 minutes before expiry' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(alert).toHaveValue('30');
});

// Octavia's I7: Notify additional emails, editable and saved.
test('additional emails to notify are added, checked, removed and saved (I7)', async ({ page }) => {
  await openSettings(page);
  const list = page.getByTestId('additional-emails');
  await expect(list).toContainText('No additional emails.');
  const input = list.getByLabel('Add an email to notify');
  await input.fill(' Office@Example.test ');
  await list.getByRole('button', { name: 'Add' }).click();
  await input.fill('partner@example.test');
  await input.press('Enter');
  await input.fill('OFFICE@example.test');
  await list.getByRole('button', { name: 'Add' }).click();
  await expect(list).toContainText('This address is already on the list');
  await input.fill('not-an-email');
  await list.getByRole('button', { name: 'Add' }).click();
  await expect(list).toContainText('Enter a valid email address');
  await input.fill('');
  await list.getByRole('button', { name: 'Remove partner@example.test' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText(['office@example.test']);
});

// Octavia's I12: a custom number of years, saved; choosing one deletes nothing.
test('a data retention period in years saves, and can be cleared (I12)', async ({ page }) => {
  await openSettings(page);
  const row = page.getByTestId('data-retention');
  const years = row.getByLabel('Data retention period (years)');
  await expect(years).toHaveValue('');
  await expect(row).toContainText('Saving a period deletes nothing.');
  await years.fill('7');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(years).toHaveValue('7');
  await years.fill('0');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(row).toContainText('Enter 1 to 100 years');
  await years.fill('');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(years).toHaveValue('');
});

test('a reminder in minutes and one in hours save (I8)', async ({ page }) => {
  await openSettings(page);
  const first = page.getByRole('combobox', { name: 'First reminder' });
  const final = page.getByRole('combobox', { name: 'Final reminder' });
  await first.selectOption({ label: '30 minutes after sending' });
  await expect(final).toHaveValue('10080');
  await final.selectOption({ label: '2 hours after sending' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
  await expect(first).toHaveValue('30');
  await expect(final).toHaveValue('120');
});

// Octavia's review of Oct 20 (I5): Submission Rules opened General instead of its own settings.
test('Submission Rules opens its own settings and rules', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: 'Submission Rules', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Submission Rules' });
  await expect(panel).toBeVisible();
  for (const name of ['Require e-signature', 'Consent checkbox required', 'Allow save and resume'])
    await expect(panel.getByRole('switch', { name })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Default form expiration' })).toHaveValue('14');
  await expect(panel.getByTestId('submission-rules')).toContainText(
    'After a client submits, the answers are locked for them.',
  );
  await expect(page.getByText('Go to General Settings')).toHaveCount(0);
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
