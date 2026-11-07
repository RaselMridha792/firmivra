import { expect, test } from '@playwright/test';

// R60, MSG-F17 and F23 (Octavia's Oct 27 Messages review): a firm message says Delivered or Read,
// and the panel's Text quick action is there only where a text can go, otherwise switched off
// with the reason. Mock mode as the Owner; texts are off in the mock, so a lead's Text says so.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

test("a client's conversation: Delivered or Read on the firm's messages, and Text off with why", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/messages'));
  await page.getByLabel('Search messages').fill('riley');
  await expect(page.getByTestId('thread-row')).toHaveCount(1, { timeout: 60_000 });
  await page.getByTestId('thread-row').first().click();
  const conversation = page.getByTestId('conversation');
  await expect(conversation).toContainText('I signed the letter');
  // A reply of the firm's: delivered into the portal, not read yet.
  await conversation.getByRole('textbox').first().fill('Thank you, we have it (synthetic).');
  await conversation.getByRole('button', { name: /^Send/ }).click();
  const mine = conversation.getByRole('listitem').filter({ hasText: 'Thank you, we have it' });
  await expect(mine.getByTestId('message-delivery')).toHaveText(/Delivered/);

  const text = page.getByTestId('contact-panel').getByTestId('contact-text');
  await expect(text).toHaveText(/Text/);
  await expect(text).toHaveAttribute('title', /Texts go to leads only/);
  await expect(page.getByTestId('contact-panel').getByRole('button', { name: 'Text' })).toHaveCount(
    0,
  );
  await page.screenshot({ path: 'e2e/screenshots/r60-messages-delivery/client.png' });
});

test("a lead's conversation: Text off with the firm's reason while texts are off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
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
    .fill('Does Thursday at 2 pm work?');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  await page
    .getByTestId('compose-outcome')
    .getByRole('link', { name: 'Open conversation' })
    .click();
  await expect(page.getByTestId('conversation')).toContainText('Avery Lawson', { timeout: 60_000 });
  const text = page.getByTestId('contact-panel').getByTestId('contact-text');
  await expect(text).toHaveAttribute('title', /Texts are turned off or not set up/, {
    timeout: 60_000,
  });
});
