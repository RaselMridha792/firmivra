import { expect, type Page, test } from '@playwright/test';

// R60, MSG-F03's Leads tab (Octavia's Messages review of Oct 27), on R1's message_threads.lead_id.
// Mock mode as the Owner: no conversation with a lead until New Message emails one; the email is
// then kept in the lead's own thread, and the next one goes from there. Avery Lawson is the first
// lead of mocks/leads-pipeline.ts. Nothing is sent anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** New Message's email to Avery Lawson, then Open conversation. */
async function emailAvery(page: Page) {
  await page.goto(app('/messages/new'));
  const recipients = page.getByRole('region', { name: 'Select Recipients' });
  await page.getByRole('tab', { name: 'Leads' }).click();
  await recipients.getByRole('checkbox', { name: 'Avery Lawson', exact: true }).check();
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Email/ })
    .click();
  await page.getByLabel('Subject (required for email)').fill('Your consultation');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Does Thursday at 2 pm work for a call? (synthetic)');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await outcome.getByRole('link', { name: 'Open conversation' }).click();
  await expect(page).toHaveURL(/\/messages\?thread=/);
  await expect(page.getByTestId('conversation')).toContainText('Avery Lawson');
}

test("MSG-F03: New Message's email to a lead is its conversation in Leads and All Messages", async ({
  page,
}) => {
  await emailAvery(page);
  const conversation = page.getByTestId('conversation');
  await expect(conversation).toContainText('Avery Lawson');
  await expect(conversation).toContainText('Your consultation');
  await expect(page.getByTestId('lead-note')).toContainText('Leads have no portal');
  const sent = conversation.getByRole('listitem').filter({ hasText: 'Does Thursday at 2 pm' });
  await expect(sent.getByTestId('message-channel')).toHaveText('Email');
  await expect(sent).toContainText('Sent');
  const panel = page.getByTestId('contact-panel');
  await expect(panel).toContainText('avery.lawson@example.test');
  await expect(panel.getByRole('link', { name: 'Open Lead' })).toHaveAttribute(
    'href',
    /^\/leads\/0199c0c0-0a00-7000-8000-000000000001\?from=/,
  );

  const rows = page.getByTestId('thread-row');
  await expect(rows).toHaveCount(7);
  await expect(page.getByRole('tab', { name: /^Leads/ })).toContainText('1');
  await page.getByRole('tab', { name: /^Leads/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Avery Lawson');
  await expect(rows.first()).toContainText('Lead');
  await page.getByRole('tab', { name: /^Clients/ }).click();
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId('thread-list')).not.toContainText('Avery Lawson');
  // A client's view leaves the lead out.
  await page.getByRole('tab', { name: /^All Messages/ }).click();
  await page.getByTestId('messages-client').selectOption({ label: 'Jamie Sample' });
  await expect(page.getByTestId('thread-list')).not.toContainText('Avery Lawson');
});

test('MSG-F03: the next email goes from the thread; a text the lead cannot get says why', async ({
  page,
}) => {
  await emailAvery(page);
  const conversation = page.getByTestId('conversation');
  const box = conversation.getByLabel('Type a message');
  await box.fill('Following up on Thursday. (synthetic)');
  await conversation.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Email sent.')).toBeVisible();
  const messages = conversation.getByRole('list', { name: 'Messages' }).getByRole('listitem');
  await expect(messages).toHaveCount(2);
  await expect(messages.last()).toContainText('Following up on Thursday.');
  await expect(messages.last().getByTestId('message-channel')).toHaveText('Email');
  // Texts are turned off in Messages Settings: nothing goes, and the screen says why.
  await conversation.getByLabel('Send as').selectOption('SMS');
  await box.fill('A text. (synthetic)');
  await conversation.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByText('This channel is turned off or not set up for your firm.'),
  ).toBeVisible();
  await expect(messages).toHaveCount(2);
  // Search finds the lead's conversation by the lead's name.
  await page.getByLabel('Search messages').fill('Avery');
  await expect(page.getByTestId('thread-row')).toHaveCount(1);
});

test('No sideways scroll at 375 px on a lead conversation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await emailAvery(page);
  await expect(page.getByTestId('lead-note')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
