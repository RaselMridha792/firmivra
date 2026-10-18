import { expect, test } from '@playwright/test';

// R56: the firm Messages page in mock mode (every module on mock data, as an Owner): six threads,
// two with unread client messages; Jamie Sample's "Tax Return Update" is the newest.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Inbox: tabs with counts, the list, the open conversation and the contact panel', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await expect(page.getByTestId('page-title')).toHaveText('Messages');
  await expect(
    page.getByRole('tablist', { name: 'Message views' }).getByRole('tab').first(),
  ).toContainText('6');
  await expect(page.getByTestId('thread-row')).toHaveCount(6);
  await expect(page.getByTestId('conversation')).toContainText('Your return is in review');
  await expect(page.getByTestId('contact-panel')).toContainText('Contact Information');
  await page.getByRole('tab', { name: /^Unread/ }).click();
  await expect(page.getByTestId('thread-row')).toHaveCount(2);
  await page.getByLabel('Search messages').fill('riley');
  await expect(page.getByTestId('thread-row')).toHaveCount(1);
});

test('Conversation: reply, mark unread and add a note', async ({ page }) => {
  await page.goto(app('/messages'));
  await page.getByLabel('Type a message').fill('Thanks, we will be in touch soon.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByTestId('conversation')).toContainText('Thanks, we will be in touch soon.');
  // Only a client's message can be marked unread: Riley's thread has one.
  await page.getByLabel('Search messages').fill('riley');
  await page.getByTestId('thread-row').first().click();
  await page.getByRole('button', { name: 'Mark read' }).click();
  await page.getByRole('button', { name: 'Mark unread' }).click();
  await expect(page.getByRole('button', { name: 'Mark read' })).toBeVisible();
  await page.getByLabel('Search messages').fill('');
  await page.getByRole('button', { name: '+ Add Note' }).click();
  await page.getByLabel('New note').fill('Call back Friday');
  await page.getByRole('button', { name: 'Save Note' }).click();
  await expect(page.getByTestId('contact-notes')).toContainText('Call back Friday');
});

test('New Message: choose a client, write it and see it in the list', async ({ page }) => {
  await page.goto(app('/messages'));
  await page.getByRole('button', { name: 'New Message' }).click();
  const dialog = page.getByTestId('new-message');
  await dialog.getByLabel('To').selectOption({ index: 1 });
  await dialog.getByLabel('Subject').fill('Welcome aboard');
  await dialog.getByLabel('Message').fill('Glad to have you.');
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message sent.')).toBeVisible();
  await expect(page.getByTestId('conversation')).toContainText('Glad to have you.');
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages'));
  await expect(page.getByTestId('thread-row').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
