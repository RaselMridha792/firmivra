import { expect, test } from '@playwright/test';

// R60, M24/M30 (Messaging Review 2): a client's drafts and scheduled messages show under their
// conversation, with Edit (New Message, Back returns) and Cancel (asked first, nothing is sent).
// Mock mode as the Owner; Jamie Sample has a portal conversation. Nothing is sent anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

test("M24: a scheduled message shows under the client's conversation; Edit and Cancel work there", async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-new').click({ timeout: 60_000 });
  await page
    .getByRole('region', { name: 'Select Recipients' })
    .getByRole('checkbox', { name: 'Jamie Sample', exact: true })
    .check();
  await page.getByLabel('Subject (optional)').fill('Quarterly check-in (fake)');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('A synthetic note.');
  await page.getByRole('switch', { name: 'Schedule Message' }).click();
  await page.getByRole('button', { name: 'Review and Schedule' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule Message' }).click();
  await expect(page.getByText('Message scheduled.')).toBeVisible();

  // Back to Messages, Jamie's conversation: the scheduled one is listed with its time.
  await page.getByTestId('back-to-origin').click();
  const row = page.getByTestId('thread-row').filter({ hasText: 'Jamie Sample' }).first();
  await row.click({ timeout: 60_000 });
  const pending = page.getByTestId('conversation').getByTestId('client-pending');
  const item = pending.getByRole('listitem').filter({ hasText: 'Quarterly check-in (fake)' });
  await expect(item).toContainText(/Scheduled for .* \(America\/New_York\)/);

  // Edit opens it in New Message, and Back returns to the conversation.
  await item.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Subject (optional)')).toHaveValue('Quarterly check-in (fake)');
  await page.getByTestId('back-to-origin').click();
  await expect(page.getByTestId('conversation')).toBeVisible();

  // Cancel asks first; Keep It changes nothing, Cancel Message removes it from the list.
  await item.getByRole('button', { name: 'Cancel' }).click();
  const ask = page.getByRole('dialog', { name: 'Cancel this scheduled message?' });
  await ask.getByRole('button', { name: 'Keep It' }).click();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Cancel' }).click();
  await ask.getByRole('button', { name: 'Cancel Message' }).click();
  await expect(page.getByText('Scheduled message canceled.')).toBeVisible();
  await expect(item).toHaveCount(0);
});
