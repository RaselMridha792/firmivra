import { expect, test } from '@playwright/test';

// R60, MSG-F09, F10, F11, F14, F15 (Octavia's Messages review of Oct 27; Frame 2): New Message is
// its own page. Clients, Leads or Both, several at once, the count and Clear All; the channel with
// who it reaches and why not; a template, merge fields and emoji; the Review; Save Draft and
// reopen; Send once; Schedule, then cancel. Mock mode as the
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
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
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
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
  await expect(page.getByText('An email needs a subject.')).toBeVisible();
  await page.getByLabel('Subject (required for email)').fill('Hello (sample)');
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeEnabled();
  await channel.getByRole('radio', { name: /Text \/ SMS/ }).click();
  await expect(page.getByTestId('compose-preview')).toContainText('This channel is not available');
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
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

  await page.getByRole('button', { name: 'Review and Send' }).click();
  const review = page.getByTestId('compose-review');
  await expect(review).toContainText('Acme Widgets LLC (fake)');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
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
  await page.getByRole('button', { name: 'Review and Schedule' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule Message' }).click();
  await expect(page.getByText('Message scheduled.')).toBeVisible();
  await expect(page.getByTestId('compose-scheduled')).toContainText('America/New_York');
  await page.getByRole('button', { name: 'Cancel Schedule' }).click();
  await expect(page.getByTestId('compose-outcome')).toContainText('Canceled: nothing was sent');
});

test('Template, merge fields and emoji; the Review fills each person and asks about unfilled fields', async ({
  page,
}) => {
  await open(page);
  await pick(page, 'Jamie Sample').check();
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Email/ })
    .click();
  const template = page.getByLabel('Message Template');
  const option = template.locator('option', { hasText: 'Tax Season Reminder (2026)' });
  await expect(option).toHaveCount(1);
  await template.selectOption((await option.getAttribute('value')) ?? '');
  await page.getByRole('button', { name: 'Use Template' }).click();
  await expect(page.getByLabel('Subject (required for email)')).not.toHaveValue('');
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Hi ');
  await page.getByLabel('Merge Fields').selectOption('Client First Name');
  await expect(message).toHaveValue('Hi [Client First Name]');
  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: 'Insert 👋' }).click();
  await expect(message).toHaveValue('Hi [Client First Name]👋');
  await message.fill('Hi [Client First Name], your code is [Fake Field].');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  const review = page.getByTestId('compose-review');
  await expect(review).toContainText('Hi Jamie, your code is [Fake Field].');
  await expect(review).toContainText('[Fake Field]');
  const send = page.getByRole('dialog').getByRole('button', { name: 'Send Message' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Send them as written where they cannot be filled').check();
  await send.click();
  await expect(page.getByTestId('compose-outcome')).toContainText('Message sent');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages/new'));
  await expect(page.getByRole('region', { name: 'Select Recipients' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
