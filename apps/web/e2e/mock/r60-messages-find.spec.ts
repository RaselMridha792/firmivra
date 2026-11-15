import { expect, test } from '@playwright/test';

// R60, M18 (Messaging Review 2): find words inside one conversation: only the messages that have
// them stay, with how many, and clearing the box shows them all. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('M18: a keyword search inside the open conversation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/messages'));
  await page.getByLabel('Search messages').fill('riley');
  await expect(page.getByTestId('thread-row')).toHaveCount(1, { timeout: 60_000 });
  await page.getByTestId('thread-row').first().click();
  const conversation = page.getByTestId('conversation');
  const messages = conversation.getByRole('list', { name: 'Messages' }).getByRole('listitem');
  await expect(conversation).toContainText('I signed the letter');
  // A reply of the firm's, so the conversation has more than one message.
  await conversation.getByRole('textbox').last().fill('Thank you, we have it (synthetic).');
  await conversation.getByRole('button', { name: /^Send/ }).click();
  await expect(messages.filter({ hasText: 'Thank you, we have it' })).toHaveCount(1);
  const all = await messages.count();
  expect(all).toBeGreaterThan(1);

  const find = conversation.getByRole('searchbox', { name: 'Search this conversation' });
  await find.fill('SIGNED the');
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText('I signed the letter');
  await expect(conversation.getByTestId('conversation-search-count')).toHaveText(
    `1 of ${all} messages`,
  );
  await find.fill('no such words here');
  await expect(messages).toHaveCount(0);
  await expect(conversation.getByTestId('conversation-search-count')).toContainText(
    'No message here has',
  );
  await find.fill('');
  await expect(messages).toHaveCount(all);
});
