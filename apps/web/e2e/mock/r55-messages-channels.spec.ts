import { expect, type Page, test } from '@playwright/test';

// R55, Communications and Messaging Review Two, M19 (playwright.mock.config.ts, as the Owner; the
// mock answers and refuses as the API does: src/lib/outbound-channels-mock.test.ts). One New
// Message to several channels: "Also send by" under the channel makes one message per channel at
// Send or Schedule, each to who its own channel reaches. The review shows each channel's count and
// who it cannot reach; the result and Drafts and Scheduled show each message with its channel.
// Mock data: Jamie Sample has the portal and an email, Acme Widgets has neither portal nor a way
// to get an email notice; texts are turned off. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PDF = { name: 'Engagement_Letter.pdf', mimeType: 'application/pdf' };

async function start(page: Page, ...names: string[]) {
  await page.goto(app('/messages/new'));
  const recipients = page.getByRole('region', { name: 'Select Recipients' });
  for (const name of names)
    await recipients.getByRole('checkbox', { name, exact: true }).check({ timeout: 60_000 });
}
const also = (page: Page, name: 'Email' | 'Portal Message' | 'Text / SMS') =>
  page.getByTestId('compose-also').getByRole('checkbox', { name, exact: true });

test('M19: Portal and Email make two messages; the review counts each channel', async ({
  page,
}) => {
  await start(page, 'Jamie Sample', 'Acme Widgets LLC (fake)');
  // Texts are off in this firm: that box cannot be ticked.
  await expect(also(page, 'Text / SMS')).toBeDisabled();
  await also(page, 'Email').check();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A synthetic update.');
  // Email needs a subject, also as the second channel.
  await expect(page.getByText('An email needs a subject.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
  await page.getByLabel('Subject (required for email)').fill('Your update (sample)');
  const preview = page.getByTestId('compose-preview');
  await expect(preview.getByTestId('compose-reach')).toContainText(
    'Portal Message: 1 of 2 can receive it.',
  );
  await expect(preview.getByTestId('compose-reach-also')).toHaveText(
    'Email: 1 of 2 can receive it.',
  );

  await page.getByRole('button', { name: 'Review and Send' }).click();
  const channels = page.getByTestId('review-channels');
  const portal = channels.getByRole('listitem').filter({ hasText: 'Portal Message:' });
  const email = channels.getByRole('listitem').filter({ hasText: /^Email:/ });
  await expect(portal).toContainText('Portal Message: 1 of 2 can receive it');
  await expect(portal).toContainText('Acme Widgets LLC (fake): No portal access');
  await expect(email).toContainText('Email: 1 of 2 can receive it');
  await expect(email).toContainText('Acme Widgets LLC (fake): No portal access');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();

  // One result per channel, each with who got it; the links once, at the end.
  const outcomes = page.getByTestId('compose-outcome');
  await expect(outcomes).toHaveCount(2);
  await expect(outcomes.nth(0)).toContainText('Message sent');
  await expect(outcomes.nth(0)).toContainText('Portal Message');
  await expect(outcomes.nth(1)).toContainText('Email');
  for (const i of [0, 1])
    await expect(
      outcomes.nth(i).getByRole('listitem').filter({ hasText: 'Jamie Sample' }),
    ).toContainText('Sent');
  await expect(outcomes.getByRole('link', { name: 'Back to Messages' })).toHaveCount(1);
});

test('M19: files alone go by portal only; with Email also chosen the message needs words', async ({
  page,
}) => {
  await start(page, 'Jamie Sample');
  await page.getByLabel('Attach files').setInputFiles({
    name: PDF.name,
    mimeType: PDF.mimeType,
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await expect(page.getByTestId('compose-files')).toContainText(PDF.name);
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeEnabled();
  await also(page, 'Email').check();
  await page.getByLabel('Subject (required for email)').fill('Your letter');
  await expect(
    page.getByText('Email and text carry the words: write a message.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
  // With words it goes: the file with the Portal message only.
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Here is your letter.');
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcomes = page.getByTestId('compose-outcome');
  await expect(outcomes).toHaveCount(2);
  await outcomes.nth(0).getByRole('link', { name: 'Open conversation' }).click();
  await expect(page.getByTestId('conversation').getByTestId('message-files')).toContainText(
    PDF.name,
  );
});

test('M19: Schedule makes one scheduled message per channel, each listed with its channel', async ({
  page,
}) => {
  await start(page, 'Jamie Sample');
  await also(page, 'Email').check();
  await page.getByLabel('Subject (required for email)').fill('Quarter end (fake)');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('A scheduled synthetic note.');
  await page.getByRole('switch', { name: 'Schedule Message' }).click();
  await page.getByRole('button', { name: 'Review and Schedule' }).click();
  await expect(page.getByTestId('review-channels').getByRole('listitem')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule Message' }).click();
  await expect(page.getByText('2 messages scheduled, one for each channel.')).toBeVisible();
  // This one (Portal) stays open with its Cancel Schedule; it stays on its channel now.
  await expect(page.getByTestId('compose-scheduled')).toContainText('America/New_York');
  await expect(also(page, 'Email')).toBeDisabled();
  await expect(page.getByTestId('compose-also')).toContainText(
    'A scheduled message stays on its channel.',
  );
  // The Email one is its own scheduled message, listed with its channel.
  await expect(
    page
      .getByTestId('compose-drafts')
      .getByRole('listitem')
      .filter({ hasText: 'Quarter end (fake)' }),
  ).toContainText('Email · Scheduled');
  // Canceling this one leaves the other scheduled.
  await page.getByRole('button', { name: 'Cancel Schedule' }).click();
  await expect(page.getByTestId('compose-outcome')).toContainText('Canceled: nothing was sent');
});
