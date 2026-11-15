import { expect, test } from '@playwright/test';

// Tax Returns Review 2, Messaging (R60, Nov 15): the email a client gets about a firm message.
// The firm's defaults in Messages Settings, the choices per send in the composer, the message
// text only when chosen (with a warning) and a saved client preference. Mock mode as the Owner;
// the mock resolves the choices as the API does. Nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('Messages Settings: the client email defaults, with the warning for the message text', async ({
  page,
}) => {
  await page.goto(app('/messages/settings'));
  const card = page.getByRole('region', { name: 'Client Email for New Messages' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const notice = card.getByRole('switch', { name: 'Email the client that a message is waiting' });
  const text = card.getByRole('switch', { name: 'Include the message text' });
  await expect(notice).toBeChecked();
  await expect(text).not.toBeChecked();
  await text.click();
  await expect(card.getByRole('note')).toContainText("don't include SSNs");
  // Turning the email off turns its text off too.
  await notice.click();
  await expect(text).not.toBeChecked();
  await expect(card.getByRole('note')).toHaveCount(0);
});

test('a new message chooses its email; Save keeps the choice for the client', async ({ page }) => {
  await page.goto(app(`/clients/${jamie}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog');
  const choices = dialog.getByTestId('email-choices');
  const text = choices.getByLabel('Include the text in the email');
  await expect(choices.getByLabel('Email them a notice with a link to the portal')).toBeChecked();
  await expect(text).not.toBeChecked();
  await text.check();
  await expect(choices.getByRole('note')).toContainText("don't include SSNs");
  await choices.getByLabel("Save as this client's preference").check();
  await dialog.getByLabel('Subject').fill('Organizer (fake)');
  await dialog.getByLabel('Message', { exact: true }).fill('Your organizer is ready (fake).');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(dialog).toHaveCount(0);
  // The next message starts from the client's saved preference.
  await page.getByRole('button', { name: 'New Message' }).click();
  await expect(
    page.getByTestId('email-choices').getByLabel('Include the text in the email'),
  ).toBeChecked();
});
