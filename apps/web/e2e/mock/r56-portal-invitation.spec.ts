import { expect, test } from '@playwright/test';

// Business Advisory B3: Send Portal Invitation from the advisory client's Client Portal tab, and the
// portal's invitation page, in mock mode (mocks/portal-invitations.ts, as an Owner). Marcus Taylor
// has no portal login yet; the mock's one valid link is #token=mock-portal-invitation-token-0001.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portalTab = `http://app.localhost:${port}/business-advisory/clients/0199c0f1-a200-7000-8000-000000000001/portal`;
const invitation = (hash: string) => `http://portal.localhost:${port}/lvp/invitation${hash}`;

test('send, resend and revoke a portal invitation, with the recipient confirmed first', async ({
  page,
}) => {
  await page.goto(portalTab);
  const card = page.getByTestId('portal-access');
  await expect(card.getByText('No portal login yet.')).toBeVisible();
  await card.getByRole('button', { name: 'Send Portal Invitation' }).click();

  const dialog = page.getByTestId('send-invitation');
  await expect(dialog.getByText(/<marcus@taylorconstruction\.example\.test>/)).toBeVisible();
  await expect(dialog.getByText('Marcus Taylor').first()).toBeVisible();
  await expect(dialog.getByText(/Primary portal login/)).toBeVisible();
  const send = page.getByRole('button', { name: 'Send Invitation' });
  await expect(send).toBeDisabled();
  await dialog.getByLabel(/I confirm marcus@taylorconstruction\.example\.test/).check();
  await send.click();
  await expect(
    page.getByText('Invitation sent to marcus@taylorconstruction.example.test.'),
  ).toBeVisible();
  await expect(card.getByTestId('invitation-line')).toContainText('Invitation sent');
  await expect(card.getByTestId('invitation-line')).toContainText('The link works until');

  await card.getByRole('button', { name: 'Resend Invitation' }).click();
  await expect(
    page.getByTestId('send-invitation').getByText(/earlier link stops working/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Revoke Invitation' }).click();
  await page.getByTestId('revoke-invitation').waitFor();
  await page.getByRole('button', { name: 'Revoke Invitation' }).last().click();
  await expect(page.getByText('Invitation revoked. Its link no longer works.')).toBeVisible();
  await expect(card.getByTestId('invitation-line')).toContainText('Revoked');
  await expect(card.getByRole('button', { name: 'Revoke Invitation' })).toHaveCount(0);
});

test('the portal invitation page: an open link leads to sign-up; an ended one says so', async ({
  page,
}) => {
  await page.goto(invitation('#token=mock-portal-invitation-token-0001'));
  const box = page.getByTestId('portal-invitation');
  await expect(box.getByRole('heading', { name: 'Accept Your Invitation' })).toBeVisible();
  await expect(box.getByText('m•••@taylorconstruction.example.test')).toBeVisible();
  await expect(box.getByRole('link', { name: 'Create My Account' })).toHaveAttribute(
    'href',
    '/lvp/sign-up',
  );

  await page.goto(invitation('#token=mock-old-link-that-was-replaced-0002'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This Invitation Link Has Ended' })).toBeVisible();
  await page.goto(invitation(''));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This Invitation Link Has Ended' })).toBeVisible();
});
