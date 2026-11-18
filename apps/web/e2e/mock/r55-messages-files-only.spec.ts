import { expect, type Page, test } from '@playwright/test';

// R55, Communications and Messaging Review Two, M22 (playwright.mock.config.ts, as the Owner; the
// mock answers as the API): New Message sends files with no text on the Portal channel, as a reply
// can. The client's conversation says what was sent (the reply's files line). Email and text still
// need a message, and with neither a text nor a file nothing can be sent. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PDF = { name: 'Engagement_Letter.pdf', mimeType: 'application/pdf' };

/** New Message to Jamie on the Portal channel, with no text. */
async function start(page: Page) {
  await page.goto(app('/messages/new'));
  const recipients = page.getByRole('region', { name: 'Select Recipients' });
  await recipients.getByRole('checkbox', { name: 'Jamie Sample', exact: true }).check();
}
const attach = (page: Page) =>
  page.getByLabel('Attach files').setInputFiles({
    name: PDF.name,
    mimeType: PDF.mimeType,
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });

test('M22: a file goes with no text on the Portal channel, and the conversation says what was sent', async ({
  page,
}) => {
  await start(page);
  // Nothing written and nothing attached: nothing to send or save yet.
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  await attach(page);
  await expect(
    page.getByTestId('compose-files').getByRole('list', { name: 'Attached files' }),
  ).toContainText(PDF.name);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await expect(page.getByTestId('compose-review')).toContainText(`Sent 1 file: ${PDF.name}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await outcome.getByRole('link', { name: 'Open conversation' }).click();
  const conversation = page.getByTestId('conversation');
  await expect(conversation.getByTestId('files-only-line')).toHaveText(`Sent 1 file: ${PDF.name}`);
  await expect(conversation.getByTestId('message-files')).toContainText(PDF.name);
});

test('M22: Email with a file and no text cannot be sent; it needs a message', async ({ page }) => {
  await start(page);
  await attach(page);
  await expect(page.getByTestId('compose-files')).toContainText(PDF.name);
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Email/ })
    .click();
  await page.getByLabel('Subject (required for email)').fill('Your letter');
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  // Back on Portal, the file alone may go again.
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Portal/ })
    .click();
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeEnabled();
});
