import { expect, test } from '@playwright/test';

// R55, Octavia's Super Admin review of Oct 31 (SA-COM): New Message asks before unsaved edits are
// lost (R5). Mock mode; 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('New Message: Cancel with unsaved edits asks Discard or Keep editing; nothing is sent (SA-COM-R5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Nothing typed: Cancel leaves at once.
  await page.goto(admin('/communications/new'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/communications$/);

  await page.goto(admin('/communications/new'));
  await page.getByRole('textbox', { name: 'Message body' }).click();
  await page.keyboard.type('Hello from the platform (synthetic).');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Discard this message?' });
  await expect(ask).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/super-admin/message-discard.png' });
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Message body' })).toContainText(
    'Hello from the platform',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Discard this message?' })
    .getByRole('button', { name: 'Discard' })
    .click();
  await expect(page).toHaveURL(/\/communications$/);
});
