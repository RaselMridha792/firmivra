import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** The mock's Terms of Service request: Sam Staff's, waiting on Mock User (the Owner). */
const WAITING = '0199b6e0-0000-7000-8000-000000000005';
/** Sam Staff's ready draft with Mock User as its approver. */
const DRAFT = '0199b6e0-0000-7000-8000-000000000097';

test('ask the sender for changes: a note is needed', async ({ page }) => {
  await page.goto(app(`/firm-sign/requests/${WAITING}`));
  await page.getByRole('button', { name: 'Review and approve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review and approve' });
  await dialog.getByRole('button', { name: 'Ask for changes' }).click();
  await expect(dialog.getByText('Say what needs to change.')).toBeVisible();

  await dialog.getByLabel(/^Note/).fill('Use the 2026 fee schedule.');
  await dialog.getByRole('button', { name: 'Ask for changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review and approve' })).toBeHidden();
});

test('send a draft for approval, then approve it', async ({ page }) => {
  await page.goto(app(`/firm-sign/requests/${DRAFT}`));
  await page.getByRole('button', { name: 'Send for approval' }).click();
  const send = page.getByRole('dialog', { name: 'Send for approval' });
  await send.getByRole('button', { name: 'Send for approval' }).click();
  await expect(send).toBeHidden();

  await page.getByRole('button', { name: 'Review and approve' }).click();
  const review = page.getByRole('dialog', { name: 'Review and approve' });
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('button', { name: 'Review and approve' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Send for approval' })).toBeHidden();
});
