import { expect, test } from '@playwright/test';

// R60, Clients E8 to E10 (Octavia's Oct 25 review). E8: the client's Documents tab has Upload
// Document (Documents' own upload, this client chosen, Back here), View on each file and View
// Request Details on each request. E9: New Message and Reply show who it goes to, where and the
// notice before sending. E10: Portal Access sends the invitation link with the recipient
// confirmed, then shows its state and Revoke. Mock mode as the Owner; client 1 is Jamie Sample
// (an active portal login), client 2 Acme Widgets LLC (none). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const jamie = '0199b6a1-0000-7000-8000-000000000001';
const acme = '0199b6a1-0000-7000-8000-000000000002';
const shots = 'e2e/screenshots/r60-clients-e8-e10';

test.describe.configure({ timeout: 180_000 });

test('E8: Upload Document, View a file and View Request Details', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${jamie}/documents`));
  const screen = page.getByTestId('client-documents-screen');
  await expect(screen).toBeVisible({ timeout: 60_000 });
  const file = page.getByTestId('client-documents-list').getByTestId('document-name').last();
  await expect(file).toHaveAttribute('href', /^\/documents\/[0-9a-f-]{36}\?from=/);

  const requests = page.getByTestId('document-requests');
  await requests
    .getByTestId('requests-desktop-table')
    .getByTestId('request-details')
    .first()
    .click();
  const details = page.getByTestId('request-details-dialog');
  await expect(details).toContainText('Service');
  await expect(details).toContainText('Files received');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/request-details.png` });
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await page.screenshot({ path: `${shots}/documents.png`, fullPage: true });

  await page.getByTestId('upload-document').click();
  await expect(page).toHaveURL(new RegExp(`/documents/upload\\?clientId=${jamie}&from=`));
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${jamie}/documents$`));
});

test('E9: a message shows who it goes to, where, and the notice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${jamie}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  const to = page.getByRole('dialog').getByTestId('message-recipient');
  await expect(to).toContainText('Jamie Sample');
  await expect(to).toContainText('Their client portal conversation');
  await expect(to).toContainText('An email to jamie.sample@example.test');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/new-message.png` });

  await page.goto(app(`/clients/${acme}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  await expect(page.getByRole('dialog').getByTestId('message-recipient')).toContainText(
    'they have no active portal login yet',
  );
});

test('E10: Portal Access sends the invitation link with the recipient confirmed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${acme}`));
  const access = page.getByTestId('portal-access');
  await expect(access).toContainText('No portal login yet', { timeout: 60_000 });
  await access.getByRole('button', { name: 'Send Portal Invitation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Portal Invitation' });
  const send = dialog.getByRole('button', { name: 'Send Invitation' });
  await expect(send).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/invite.png` });
  await send.click();
  await expect(page.getByTestId('portal-notice')).toContainText(
    'Invitation sent to books@acme.example.test',
  );
  await expect(access.getByTestId('invitation-line')).toBeVisible();
  await expect(access.getByRole('button', { name: 'Revoke Invitation' })).toBeVisible();
  await page.screenshot({ path: `${shots}/overview.png`, fullPage: true });
});
