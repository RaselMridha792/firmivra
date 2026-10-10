import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('an owner reads, replies, starts a thread and keeps a note', async ({ page }) => {
  await page.goto(app(`/clients/${JAMIE}/messages`));
  await expect(page.getByTestId('page-title')).toHaveText('Messages and Notes');
  const rows = page.getByRole('table', { name: 'Messages' }).locator('tbody tr');
  await expect(rows).toHaveCount(5);

  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'View Question About Deduction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Question About Deduction' });
  await expect(dialog.getByRole('list', { name: 'Conversation' })).toBeVisible();
  await dialog.getByLabel('Reply').fill('Thanks, we will look at this today.');
  await dialog.getByRole('button', { name: 'Send Reply' }).click();
  await expect(dialog.getByText('Thanks, we will look at this today.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('No messages')).toBeVisible();

  await page.getByRole('button', { name: 'All Messages' }).click();
  await page.getByRole('button', { name: 'New Message' }).click();
  const compose = page.getByRole('dialog', { name: 'New Message' });
  await compose.getByLabel('Subject').fill('Extension paperwork');
  await compose.getByLabel('Message').fill('Please sign the extension form this week.');
  await compose.getByRole('button', { name: 'Send Message' }).click();
  await expect(rows.filter({ hasText: 'Extension paperwork' })).toBeVisible();

  await page.getByLabel('Search messages').fill('Extension');
  await page.getByLabel('Search messages').press('Enter');
  await expect(rows).toHaveCount(1);

  await page.getByLabel('New note').fill('Asked for the extension form.');
  await page.getByRole('button', { name: 'Save Note' }).click();
  const notes = page.getByRole('list', { name: 'Internal notes' });
  await expect(notes.getByText('Asked for the extension form.')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 900 });
  await page.reload();
  await expect(page.getByRole('table', { name: 'Messages' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
