// R55, Client Portal Review One B28 (Business Advisory review §18): Send Resource offers Portal
// or Email, a Secure Link or a PDF, and a preview of exactly what the client receives with the
// eligibility checks; a client with no portal login is refused, with the reason, and Send stays
// off. In the portal, a resource sent as a PDF downloads. Mock mode, as the firm's Owner and
// client Jamie. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('B28: the preview shows what the client receives, by portal or email, as a link or a PDF', async ({
  page,
}) => {
  await page.goto(app('/business-advisory/resources'));
  await page
    .getByRole('button', { name: 'Send Cash Flow Basics to a client' })
    .click({ timeout: 60_000 });
  const dialog = page.getByTestId('send-resource');
  const send = page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true });
  const previewBox = dialog.getByTestId('resource-preview');
  await expect(previewBox).toContainText('Choose a client to see the preview.');
  await expect(send).toBeDisabled();

  await dialog.getByLabel('Advisory client').selectOption({ label: 'Alicia Park' });
  await expect(dialog.getByTestId('preview-to')).toContainText('Alicia Park');
  await expect(dialog.getByTestId('preview-to')).toContainText('(portal message)');
  await expect(dialog.getByTestId('preview-body')).toContainText(
    'Open it in your portal (sign in first)',
  );
  await expect(dialog.getByTestId('resource-eligible')).toHaveText('Ready to send.');

  await dialog.getByLabel('Send by').selectOption('EMAIL');
  await dialog.getByLabel('Format').selectOption('PDF');
  await dialog.getByLabel('Message (optional)').fill('Read it before our call (fake).');
  await expect(dialog.getByTestId('preview-to')).toContainText('(email)');
  await expect(dialog.getByTestId('preview-body')).toContainText(
    'A PDF copy is ready to download in your portal',
  );
  await expect(dialog.getByTestId('preview-body')).toContainText('Read it before our call (fake).');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('Cash Flow Basics sent to Alicia Park.')).toBeVisible();
});

test('B28: a client with no portal login is refused, with the reason, and Send stays off', async ({
  page,
}) => {
  await page.goto(app('/business-advisory/resources'));
  await page
    .getByRole('button', { name: 'Send Brand Basics Guide to a client' })
    .click({ timeout: 60_000 });
  const dialog = page.getByTestId('send-resource');
  await dialog.getByLabel('Advisory client').selectOption({ label: 'Omar Haddad' });
  await expect(dialog.getByTestId('resource-problems')).toContainText(
    'Omar Haddad has no active portal login yet',
  );
  await expect(dialog.getByTestId('resource-problems')).toContainText(
    'Send them a portal invitation first.',
  );
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  // Email needs the portal login too: the link and the PDF open after sign-in.
  await dialog.getByLabel('Send by').selectOption('EMAIL');
  await expect(dialog.getByTestId('resource-problems')).toContainText('no active portal login');
});

test('B28 (portal): a resource sent as a PDF downloads; a link one reads in the page', async ({
  page,
}) => {
  await page.goto(portal('/lvp/services/advisory'));
  const pdf = page.getByTestId('advisory-resource').filter({ hasText: 'Cash Flow Basics' });
  await expect(pdf).toContainText('PDF', { timeout: 60_000 });
  const link = page.getByTestId('advisory-resource').filter({ hasText: 'Funding Readiness' });
  await expect(link).toContainText('Secure Link');
  await expect(link.getByRole('button', { name: /Download/ })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await pdf.getByRole('button', { name: 'Download Cash Flow Basics (PDF)' }).click();
  expect((await download).suggestedFilename()).toBe('cash-flow-basics.pdf');
});
