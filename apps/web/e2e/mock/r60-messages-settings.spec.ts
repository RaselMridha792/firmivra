import { expect, test } from '@playwright/test';

// R60, MSG-F02 (Octavia's Messages review of Oct 27, her section 19): Settings in the Messages
// header opens message-specific settings with Back to Messages. Mock mode as the Owner: the
// defaults until the first save, and texts not set up yet. Nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Settings in the Messages header opens Messages Settings, with Back to Messages', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-settings').click();
  await expect(page).toHaveURL(/\/messages\/settings\?from=%2Fmessages/);
  await expect(page.getByTestId('page-title')).toHaveText('Messages Settings');
  for (const card of [
    'Channels',
    'Sender and Signature',
    'Notifications',
    'Assignment and Read Receipts',
    'Retention and Archive',
    'Attachments',
    'Quiet Hours',
    'Bulk Messages',
    'Consent and Unsubscribes',
  ])
    await expect(page.getByRole('region', { name: card })).toBeVisible();
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/messages'));
});

test('The Owner changes the channels, sender, quiet hours and attachments, and saves', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-settings').click();
  const save = page.getByRole('button', { name: 'Save Changes' });
  await expect(save).toBeDisabled();
  const channels = page.getByRole('region', { name: 'Channels' });
  await channels.getByRole('switch', { name: 'Text message (SMS)' }).click();
  await expect(channels.getByRole('note')).toContainText('Texts cannot be sent yet');
  await page.getByLabel('Sender name').fill('Fake Firm Team');
  const quietHours = page.getByRole('region', { name: 'Quiet Hours' });
  await expect(quietHours).toContainText('America/New_York');
  await quietHours.getByRole('switch', { name: 'Quiet hours' }).click();
  await expect(quietHours.getByLabel('From')).toHaveValue('21:00');
  await expect(quietHours.getByLabel('Until')).toHaveValue('08:00');
  await page.getByRole('checkbox', { name: 'CSV' }).check();
  await page.getByLabel('Largest file (MB, 1 to 25)').fill('15');
  await page.getByLabel('Default assignee').selectOption({ label: 'Sam Staff' });
  await save.click();
  await expect(page.getByText('Messages Settings saved.')).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByText(/Last changed by/)).toBeVisible();

  // Kept: Back to Messages and in again.
  await page.getByTestId('back-to-origin').click();
  await page.getByTestId('messages-settings').click();
  await expect(page.getByLabel('Sender name')).toHaveValue('Fake Firm Team');
  await expect(page.getByRole('switch', { name: 'Text message (SMS)' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('checkbox', { name: 'CSV' })).toBeChecked();
  await expect(page.getByLabel('Largest file (MB, 1 to 25)')).toHaveValue('15');
  await expect(page.getByLabel('Default assignee')).toHaveValue(/.+/);
});

test('Unsaved changes ask before Back, and Discard Changes puts them back', async ({ page }) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-settings').click();
  await page.getByLabel('Sender name').fill('Not saved');
  await page.getByTestId('back-to-origin').click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay on This Page' }).click();
  await page.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByLabel('Sender name')).toHaveValue('');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/messages'));
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages/settings'));
  await expect(page.getByRole('region', { name: 'Channels' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
