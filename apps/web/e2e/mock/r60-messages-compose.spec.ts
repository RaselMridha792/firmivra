import { expect, test } from '@playwright/test';

// R60, MSG-F09, F10, F14 (Octavia's Messages review of Oct 27; Frame 2): New Message is its own
// page. Clients, Leads or Both, several at once, the count and Clear All; the channel with who it
// reaches and why not; Save Draft and reopen; Send once; Schedule, then cancel. Mock mode as the
// Owner: Jamie Sample has the portal, Acme Widgets does not; the mock sends nothing anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const open = async (page: import('@playwright/test').Page) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-new').click();
  await expect(page).toHaveURL(/\/messages\/new\?from=%2Fmessages/);
  await expect(
    page.getByRole('region', { name: 'Select Recipients' }).getByRole('checkbox').first(),
  ).toBeVisible();
};
const pick = (page: import('@playwright/test').Page, name: string) =>
  page
    .getByRole('region', { name: 'Select Recipients' })
    .getByRole('checkbox', { name, exact: true });

test('Recipients: Clients, Leads or Both, several at once, the count and Clear All', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Jamie Sample').check();
  await pick(page, 'Acme Widgets LLC (fake)').check();
  await expect(page.getByTestId('compose-selected')).toHaveText('2 selected');
  const preview = page.getByTestId('compose-preview');
  await expect(preview).toContainText('Preview Recipients (2)');
  await expect(preview.getByRole('listitem').filter({ hasText: 'Jamie Sample' })).toContainText(
    'Can receive',
  );
  await expect(preview.getByRole('listitem').filter({ hasText: 'Acme Widgets' })).toContainText(
    'No portal access',
  );
  await page.getByRole('tab', { name: 'Leads' }).click();
  const recipients = page.getByRole('region', { name: 'Select Recipients' });
  await expect(recipients.getByRole('listitem').first()).toContainText('Lead');
  await recipients.getByRole('checkbox').first().check();
  await expect(page.getByTestId('compose-selected')).toHaveText('3 selected');
  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(page.getByTestId('compose-selected')).toHaveText('0 selected');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeDisabled();
});

test('Channel: only what reaches them, with the reason; email needs a subject', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Jamie Sample').check();
  const channel = page.getByRole('radiogroup', { name: 'Channel' });
  await expect(channel.getByRole('radio', { name: /Text \/ SMS/ })).toContainText(
    'Turned off in Messages Settings',
  );
  await channel.getByRole('radio', { name: /Email/ }).click();
  await expect(page.getByRole('region', { name: 'Message Details' })).toContainText(
    'the message itself stays in the portal',
  );
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A synthetic note.');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeDisabled();
  await expect(page.getByText('An email needs a subject.')).toBeVisible();
  await page.getByLabel('Subject (required for email)').fill('Hello (sample)');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();
  await channel.getByRole('radio', { name: /Text \/ SMS/ }).click();
  await expect(page.getByTestId('compose-preview')).toContainText('This channel is not available');
  await expect(page.getByRole('button', { name: 'Send Message' })).toBeDisabled();
});

test('Save Draft reopens with the recipients, channel and text; Send goes once', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Jamie Sample').check();
  await pick(page, 'Acme Widgets LLC (fake)').check();
  await page.getByLabel('Subject (optional)').fill('Year-end checklist (sample)');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Please review your year-end checklist (synthetic).');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page).toHaveURL(/\/messages\/new\?.*id=[0-9a-f-]+/);
  await page.getByTestId('back-to-origin').click();
  await page.getByTestId('messages-new').click();
  const drafts = page.getByTestId('compose-drafts');
  await expect(drafts).toContainText('Year-end checklist (sample)');
  await drafts.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByLabel('Subject (optional)')).toHaveValue('Year-end checklist (sample)');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Please review your year-end checklist (synthetic).',
  );
  await expect(page.getByTestId('compose-selected')).toHaveText('2 selected');

  await page.getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await expect(outcome.getByRole('listitem').filter({ hasText: 'Jamie Sample' })).toContainText(
    'Sent',
  );
  await expect(outcome.getByRole('listitem').filter({ hasText: 'Acme Widgets' })).toContainText(
    'No portal access',
  );
  await outcome.getByRole('link', { name: 'Open conversation' }).click();
  await expect(page.getByTestId('conversation')).toContainText(
    'Please review your year-end checklist',
  );
});

test('Schedule in the firm time zone, then cancel before it goes', async ({ page }) => {
  await open(page);
  await pick(page, 'Jamie Sample').check();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('A scheduled synthetic note.');
  await page.getByRole('switch', { name: 'Schedule Message' }).click();
  await expect(page.getByRole('region', { name: 'Additional Options' })).toContainText(
    'America/New_York',
  );
  await page.getByRole('button', { name: 'Schedule Message' }).click();
  await expect(page.getByText('Message scheduled.')).toBeVisible();
  await expect(page.getByTestId('compose-scheduled')).toContainText('America/New_York');
  await page.getByRole('button', { name: 'Cancel Schedule' }).click();
  await expect(page.getByTestId('compose-outcome')).toContainText('Canceled: nothing was sent');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages/new'));
  await expect(page.getByRole('region', { name: 'Select Recipients' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
