import { expect, type Page, test } from '@playwright/test';

// Octavia's Client Sign-ups, Resolve Existing Account (D2, Rasel's rules of Oct 26): the three
// checks are recorded per existing record and count for 24 hours; Link Existing Record and
// Restore Access open only with them; Not a Match is for phone matches, with a reason; an email
// match never. In mock mode (playwright.mock.config.ts) as the Owner: Lee Roe matches CL-10005
// by phone (no portal login), Sam Poe matches CL-10003 by email (it has a login). Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const panel = (page: Page) => page.getByTestId('sign-up-panel');
const dialog = (page: Page) => page.getByRole('dialog');

async function review(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/sign-ups'));
  await page.getByRole('button', { name: `Review ${name}'s request` }).click();
  await expect(panel(page).getByTestId('match-alert')).toBeVisible();
}

async function recordChecks(page: Page, contact: string, permission: string) {
  await panel(page).getByRole('button', { name: 'Record Checks' }).click();
  const d = dialog(page);
  await d.getByLabel('Who you called').selectOption(contact);
  await d.getByLabel('The call').selectOption('REACHED');
  await d.getByLabel('Identity').selectOption('VERIFIED');
  await d.getByLabel("The client's permission").selectOption(permission);
  await d.getByRole('button', { name: 'Record Checks' }).click();
  await expect(d).toHaveCount(0);
}

test('F08 to F10: after the three checks, Link Existing Record keeps the Client ID', async ({
  page,
}) => {
  await review(page, 'Lee Roe');
  const p = panel(page);
  await expect(p.getByRole('button', { name: 'Link Existing Record' })).toBeDisabled();
  await expect(p).toContainText('Not recorded yet');

  // The record has no email-only contact rule here: Lee's record has a phone and an email.
  await recordChecks(page, 'CLIENT_PHONE', 'LINK_RECORD');
  for (const name of [
    'Call the contact already on file',
    "Verify the client's identity",
    "Record the client's permission",
  ]) {
    await expect(p.getByRole('checkbox', { name })).toBeChecked();
  }
  await expect(p).toContainText('They count until');
  await expect(p.getByRole('button', { name: 'Restore Access' })).toBeDisabled();
  await p.getByRole('button', { name: 'Link Existing Record' }).click();
  await expect(dialog(page)).toContainText('Its Client ID and contacts stay as they are');
  await dialog(page).getByRole('button', { name: 'Link Existing Record' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    'Lee Roe is linked to CL-10005 and can now use your client portal.',
  );
});

test('F12: Not a Match with a reason lets a phone match be approved as a new client', async ({
  page,
}) => {
  await review(page, 'Lee Roe');
  const p = panel(page);
  await p.getByRole('button', { name: 'Not a Match' }).click();
  const confirm = dialog(page).getByRole('button', { name: 'Not a Match' });
  await expect(confirm).toBeDisabled();
  await dialog(page).getByLabel('Why they are not this person').fill('A different Lee Roe');
  await confirm.click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    'The matching records are marked as not Lee Roe.',
  );
  await expect(p).toContainText('No match found');
  await expect(p.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await expect(page.getByTestId('sign-up-activity')).toContainText('Marked not a match');
  await expect(page.getByTestId('sign-up-activity')).toContainText('A different Lee Roe');
});

test('S02, S03: an email match with a login is restored, never linked or marked not a match', async ({
  page,
}) => {
  await review(page, 'Sam Poe');
  const p = panel(page);
  await expect(p).toContainText('has a portal login');
  await expect(p.getByRole('button', { name: 'Not a Match' })).toHaveCount(0);
  await recordChecks(page, 'CLIENT_EMAIL', 'BOTH');
  await expect(p.getByRole('button', { name: 'Link Existing Record' })).toBeDisabled();
  await p.getByRole('button', { name: 'Restore Access' }).click();
  await expect(dialog(page)).toContainText('no new client is made');
  await dialog(page).getByRole('button', { name: 'Restore Access' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    "Sam Poe's existing login was sent a recovery email. This request is closed.",
  );
});
