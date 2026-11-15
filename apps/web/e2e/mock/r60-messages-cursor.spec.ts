import { expect, test } from '@playwright/test';

// R60, M26 (Messaging Review 2): a merge field or an emoji goes in at the cursor, and a template
// used after typing keeps the typed text and subject. New Message and the reply box. Mock mode as
// the Owner; nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

test('M26: New Message puts a merge field at the cursor; a template keeps what was typed', async ({
  page,
}) => {
  await page.goto(app('/messages/new'));
  await page
    .getByRole('region', { name: 'Select Recipients' })
    .getByRole('checkbox', { name: 'Jamie Sample', exact: true })
    .check({ timeout: 60_000 });
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Email/ })
    .click();
  const subject = page.getByLabel('Subject (required for email)');
  await subject.fill('Kept subject (fake)');
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Hello there.');
  // The cursor right after "Hello".
  await message.press('Home');
  for (let i = 0; i < 5; i += 1) await message.press('ArrowRight');
  await page.getByLabel('Merge Fields').selectOption('Client First Name');
  await expect(message).toHaveValue('Hello [Client First Name] there.');

  const template = page.getByLabel('Message Template');
  const option = template.locator('option', { hasText: 'Tax Season Reminder (2026)' });
  await template.selectOption((await option.getAttribute('value')) ?? '');
  await page.getByRole('button', { name: 'Use Template' }).click();
  // The template goes in at the cursor; the typed text and the subject stay.
  await expect(message).toHaveValue(/^Hello \[Client First Name\][\s\S]+ there\.$/);
  await expect(subject).toHaveValue('Kept subject (fake)');
});

test('M26: the reply box puts an emoji at the cursor', async ({ page }) => {
  await page.goto(app('/messages'));
  await page
    .getByTestId('thread-row')
    .filter({ hasText: 'Jamie Sample' })
    .first()
    .click({ timeout: 60_000 });
  const reply = page.getByTestId('conversation').getByLabel('Type a message');
  await reply.fill('Thanks!');
  await reply.press('Home');
  await page.getByTestId('conversation').getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('button', { name: 'Insert 👋' }).click();
  await expect(reply).toHaveValue('👋Thanks!');
});
