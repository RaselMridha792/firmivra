import { expect, test } from '@playwright/test';

// N09 Messages and Notes in mock mode (mocks/messages.ts: client 1's threads; the private note).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('threads filter, open and mark read, and take a reply', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/messages'));
  await expect(page).toHaveTitle('Messages and Notes');
  const table = page.getByRole('table', { name: 'Messages' });
  await expect(table).toContainText('Tax Return Update');
  await expect(table).not.toContainText('Engagement letter');
  const menu = page.getByRole('navigation', { name: 'Main' });
  const badge = menu.getByRole('link', { name: /Messages/ });
  await expect(badge).toContainText('unread');
  await page.screenshot({ path: testInfo.outputPath('messages-1440.png'), fullPage: true });

  await page.getByRole('button', { name: 'Messages I Sent', exact: true }).click();
  await expect(table).not.toContainText('Tax Return Update');
  await page.getByRole('button', { name: 'All Messages', exact: true }).click();

  await page.getByRole('button', { name: 'View Tax Return Update' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'Conversation' })).toContainText(
    'Your return is in review',
  );
  await dialog.getByLabel('Reply').fill('Thank you, I will wait.');
  await dialog.getByRole('button', { name: 'Send Reply' }).click();
  await expect(dialog.getByRole('list', { name: 'Conversation' })).toContainText(
    'Thank you, I will wait.',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'View Document Request' }).click();
  await expect(page.getByRole('dialog')).toContainText('Replies are closed');
  await page.keyboard.press('Escape');
});

test('send a new message and save a private note', async ({ page }, testInfo) => {
  await page.goto(portal('/lvp/messages'));
  await page
    .getByRole('button', { name: /^Send a Message/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Send a Message' });
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(dialog).toContainText('Enter a subject');
  await dialog.getByLabel('Subject').fill('Estimated payments');
  await dialog.getByLabel('Message').fill('When is the next estimated payment due?');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
    'When is the next estimated payment due?',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table', { name: 'Messages' })).toContainText('Estimated payments');

  await page.getByLabel('Your note').fill('Gather the 1099 forms before the meeting.');
  await page.getByLabel('Set as reminder').check();
  await page.getByLabel('Remind me on').fill('2099-01-20T09:00');
  await page.getByRole('button', { name: 'Save Note' }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('messages-375.png'), fullPage: true });
});
