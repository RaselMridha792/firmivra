import { expect, test } from '@playwright/test';

// R60, M21 (Messaging Review 2): Cancel with an unsaved message asks before the text is lost;
// Keep Editing keeps it, Discard Message leaves. Without changes Cancel just leaves. Mock mode as
// the Owner; nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('New Message: Cancel with unsaved text asks; Keep Editing keeps it, Discard leaves', async ({
  page,
}) => {
  await page.goto(app('/messages/new'));
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Your organizer is ready (synthetic).', { timeout: 60_000 });
  await page.getByTestId('compose-cancel').click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave.getByTestId('leave-unsaved')).toBeVisible();
  await leave.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(leave).toHaveCount(0);
  await expect(message).toHaveValue('Your organizer is ready (synthetic).');
  await expect(page).toHaveURL(/\/messages\/new/);
  await page.getByTestId('compose-cancel').click();
  await leave.getByRole('button', { name: 'Discard Message' }).click();
  await expect(page).toHaveURL(/\/messages$/);

  // Nothing typed: Cancel leaves at once.
  await page.goto(app('/messages/new'));
  await expect(message).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('compose-cancel').click();
  await expect(page).toHaveURL(/\/messages$/);
});

test("A client's New Message asks before closing with unsaved text", async ({ page }) => {
  await page.goto(app(`/clients/${jamie}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await dialog.getByLabel('Message', { exact: true }).fill('A draft (synthetic).');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await leave.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(dialog.getByLabel('Message', { exact: true })).toHaveValue('A draft (synthetic).');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await leave.getByRole('button', { name: 'Discard Message' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
